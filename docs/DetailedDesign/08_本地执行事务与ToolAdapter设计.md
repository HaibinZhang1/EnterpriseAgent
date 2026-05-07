# 08. 本地执行事务与 Tool Adapter 设计

## 8.1 设计目标

本地文件和配置操作是客户端风险最高的部分。必须统一通过执行计划完成，避免每个业务功能直接写文件导致不可回滚、不可审计、不可测试。

所有以下操作都必须生成 `ExecutionPlan`：

- Skill 安装、启用、停用、更新、卸载；
- MCP 配置写入、更新、停用、卸载；
- Plugin managed-package 安装、更新、卸载；
- Plugin config-plugin 配置写入、启用、禁用、卸载；
- manual-download 本地记录清理；
- 安全下架强制停用托管项。

## 8.2 ExecutionPlan 模型

```ts
interface ExecutionPlan {
  planId: string;
  requestId?: string;
  operation: LocalOperation;
  extensionId?: string;
  version?: string;
  createdAt: string;
  dryRun: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: PlanSummary;
  preconditions: Precondition[];
  steps: PlanStep[];
  rollbackPolicy: RollbackPolicy;
  idempotencyKey: string;
}
```

`PlanSummary`：

```ts
interface PlanSummary {
  addTargets: TargetSummary[];
  removeTargets: TargetSummary[];
  overwriteTargets: TargetSummary[];
  configChanges: ConfigChangeSummary[];
  skippedTargets: SkippedTargetSummary[];
  expectedMode: 'SYMLINK' | 'COPY' | 'CONFIG_WRITE' | 'CONTROLLED_DOWNLOAD' | 'MIXED';
}
```

`Precondition`：

```ts
type Precondition =
  | { type: 'path-exists'; path: string; required: boolean }
  | { type: 'path-writable'; path: string }
  | { type: 'hash-matches'; path: string; sha256: string }
  | { type: 'tool-compatible'; toolId: string; versionRange?: string }
  | { type: 'not-managed-conflict'; target: string }
  | { type: 'symlink-capability'; fallback: 'copy' };
```

## 8.3 PlanStep 枚举

```ts
type PlanStep =
  | { stepId: string; type: 'create-dir'; path: string }
  | { stepId: string; type: 'write-file-atomic'; path: string; contentRef: string; backup: boolean }
  | { stepId: string; type: 'copy-file'; from: string; to: string; backup: boolean; expectedSha256?: string }
  | { stepId: string; type: 'copy-tree'; from: string; to: string; backup: boolean }
  | { stepId: string; type: 'symlink'; from: string; to: string; fallback: 'copy'; backup: boolean }
  | { stepId: string; type: 'json-upsert'; path: string; jsonPointer: string; valueRef: string; backup: boolean }
  | { stepId: string; type: 'json-remove'; path: string; jsonPointer: string; backup: boolean }
  | { stepId: string; type: 'remove-path'; path: string; backup: boolean }
  | { stepId: string; type: 'verify-hash'; path: string; sha256: string }
  | { stepId: string; type: 'record-local-state'; stateRef: string }
  | { stepId: string; type: 'delete-secret'; secretRef: string }
  | { stepId: string; type: 'save-secret'; secretRef: string; valueRef: string };
```

禁止在 MVP 中出现：

```text
exec-script
shell-command
download-and-run
arbitrary-write
```

若后续需要脚本能力，必须新增安全设计、沙箱和审批，不应混入当前执行器。

## 8.4 LocalExecutor 流程

```ts
class LocalExecutor {
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    validatePlan(plan);
    const journal = await createExecutionJournal(plan);
    let result: ExecutionResult | undefined;

    try {
      await checkPreconditions(plan.preconditions);
      for (const step of plan.steps) {
        await executeStepWithJournal(step, journal);
      }
      await markSuccess(journal);
      result = successResult(journal);
      return result;
    } catch (error) {
      const rollback = await rollbackManager.rollback(journal, plan.rollbackPolicy);
      if (rollback.fullRollback) {
        result = failureWithRollback(error, rollback);
      } else if (rollback.partialRollback) {
        result = partialSuccess(error, rollback);
      } else {
        result = failureWithoutRollback(error, rollback);
      }
      return result;
    } finally {
      const finalResult = result ?? failureWithoutRollback(new Error('unknown execution failure'), { attempted: false });
      await persistExecutionRecord(plan, finalResult);
      await enqueueLocalEvent(plan, finalResult);
    }
  }
}
```

## 8.5 原子写策略

### 文件写入

```text
read existing -> backup -> write path.tmp -> fsync -> rename tmp to target
```

### JSON 配置写入

```text
read config -> parse -> validate -> backup -> modify in memory -> write temp -> rename
```

### 目录替换

```text
copy to target.staging -> verify -> backup old target -> rename old -> rename staging -> cleanup
```

### Central Store 当前指针

```text
write current.json.tmp -> rename current.json.tmp current.json
```

不得在 Hash 未通过时覆盖旧版本。

## 8.6 备份策略

`BackupStore` 目录：

```text
backups/
└── <executionId>/
    ├── manifest.json
    ├── files/
    └── configs/
```

`manifest.json`：

```json
{
  "executionId": "exec_01HX",
  "operation": "MCP_CONFIG_WRITE",
  "createdAt": "2026-05-06T10:00:00Z",
  "items": [
    {
      "targetPath": "C:/...",
      "backupPath": "files/001",
      "type": "FILE",
      "sha256": "64hex"
    }
  ]
}
```

备份保留策略：

- 默认保留最近 30 天或最近 100 次执行；
- 安全下架强制停用产生的备份保留更久，由本地设置控制；
- 清理备份也写本地普通日志，不上报敏感路径明文。

## 8.7 部分成功策略

多目标操作中，部分目标成功、部分失败时：

- 不强制撤销所有成功目标；
- 对已经覆盖且可回滚目标自动回滚；
- 对未受影响或成功目标保留；
- 结果状态为 `PARTIAL_SUCCESS`；
- 本地事件包含失败目标摘要和错误码；
- UI 可展示失败列表，但本设计不定义 UI 形态。

`ExecutionResult`：

```ts
interface ExecutionResult {
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';
  completedSteps: string[];
  failedStep?: string;
  rollback: {
    attempted: boolean;
    status: 'NOT_NEEDED' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE';
    failedItems: RollbackFailure[];
  };
  targetResults: TargetResult[];
  error?: DesktopError;
}
```

## 8.8 symlink 降级 copy

Skill 启用优先使用 symlink。检测失败时：

1. 记录环境能力 `symlinkAvailable=false`；
2. 执行计划将 symlink step 标记 fallback；
3. 实际执行 copy；
4. 本地事件 `SYMLINK_FALLBACK_COPY`；
5. 本地状态记录目标实际模式，停用/卸载时按实际模式清理。

降级原因：

- Windows 开发者模式关闭；
- 普通用户权限不足；
- 目标文件系统不支持；
- 企业策略禁止。

## 8.9 ToolAdapter 接口

```ts
interface ToolAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly toolName: string;
  readonly supportedPlatforms: Platform[];

  detect(ctx: DetectContext): Promise<ToolDetectionResult[]>;

  capabilities(tool: DetectedTool): AdapterCapabilities;

  buildSkillEnablePlan(input: SkillEnableInput): Promise<ExecutionPlan>;
  buildSkillDisablePlan(input: SkillDisableInput): Promise<ExecutionPlan>;

  buildMcpWritePlan(input: McpWriteInput): Promise<ExecutionPlan>;
  buildMcpRemovePlan(input: McpRemoveInput): Promise<ExecutionPlan>;
  buildMcpUpdatePlan(input: McpUpdateInput): Promise<ExecutionPlan>;

  buildPluginInstallPlan(input: PluginInstallInput): Promise<ExecutionPlan>;
  buildPluginUninstallPlan(input: PluginUninstallInput): Promise<ExecutionPlan>;
  buildPluginUpdatePlan(input: PluginUpdateInput): Promise<ExecutionPlan>;

  runConnectionTest?(input: McpConnectionTestInput): Promise<ConnectionTestResult>;
}
```

### AdapterCapabilities

```ts
interface AdapterCapabilities {
  supportsSkill: boolean;
  supportsMcpConfigWrite: boolean;
  supportsPluginInstall: boolean;
  supportsSymlink: boolean;
  supportsCopy: boolean;
  supportsConfigWrite: boolean;
  supportsControlledDownload: boolean;
  supportsConnectionTest: boolean;
  supportsRollback: boolean;
  supportsDryRun: boolean;
  supportedPluginInstallModes: PluginInstallMode[];
  supportedTargetVersions?: string[];
}
```

## 8.10 Adapter Manifest

每个适配器使用 manifest 声明静态能力，代码实现动态检测。manifest 只声明默认路径规则和能力，不代表工具一定已安装；实际可用性由 `detect()` 和 dry-run 结果决定。

### Manifest Schema

```ts
interface ToolAdapterManifest {
  adapterId: 'codex' | 'claude' | 'cursor' | 'windsurf' | 'opencode' | 'custom-directory';
  adapterVersion: string;
  toolName: string;
  supportedPlatforms: Array<'windows-x64'>;
  capabilities: AdapterCapabilities;
  detection: {
    processNames?: string[];
    defaultInstallPaths?: string[];
    configFiles?: string[];
  };
  pathRules: {
    skillTargets: PathRule[];
    mcpConfigPaths: PathRule[];
    pluginTargets: PathRule[];
  };
  safety: {
    allowArbitraryWrite: false;
    allowShellExecution: false;
    dryRunRequired: true;
    backupRequired: true;
  };
}
```

`PathRule.path` 可以包含以下变量：`%USERPROFILE%`、`%APPDATA%`、`%LOCALAPPDATA%`、`{projectPath}`、`{toolConfigDir}`。变量必须由客户端后端白名单展开，不允许 manifest 自定义任意环境变量展开。

### MVP 内置适配器能力矩阵

| adapterId | Skill | MCP 配置写入 | Plugin managed-package | Plugin config-plugin | manual-download | 说明 |
|---|---:|---:|---:|---:|---:|---|
| codex | 是 | 是 | 否 | 是，需 manifest 声明 | 是 | MVP 首选完整适配器 |
| claude | 是 | 是 | 否 | 是，需 manifest 声明 | 是 | MCP 路径需检测用户配置目录 |
| cursor | 是 | 是 | 否 | 是，需 manifest 声明 | 是 | 以配置文件写入能力为主 |
| windsurf | 是 | 是 | 否 | 是，需 manifest 声明 | 是 | 与 Cursor 类似 |
| opencode | 是 | 是 | 否 | 是，需 manifest 声明 | 是 | 支持自定义配置目录 |
| custom-directory | 是 | 否 | 否 | 否 | 是 | 只支持用户显式目录，不扫描全盘 |

### codex.adapter.json

```json
{
  "adapterId": "codex",
  "adapterVersion": "1.0.0",
  "toolName": "Codex",
  "supportedPlatforms": ["windows-x64"],
  "capabilities": {
    "supportsSkill": true,
    "supportsMcpConfigWrite": true,
    "supportsPluginInstall": true,
    "supportsSymlink": true,
    "supportsCopy": true,
    "supportsConfigWrite": true,
    "supportsControlledDownload": true,
    "supportsConnectionTest": true,
    "supportsRollback": true,
    "supportsDryRun": true,
    "supportedPluginInstallModes": ["CONFIG_PLUGIN", "MANUAL_DOWNLOAD"]
  },
  "detection": {
    "processNames": ["codex.exe"],
    "defaultInstallPaths": ["%LOCALAPPDATA%/Programs/Codex"],
    "configFiles": ["%APPDATA%/Codex/config.json"]
  },
  "pathRules": {
    "skillTargets": [
      {"id": "codex-user-skills", "path": "%APPDATA%/Codex/skills", "mode": "symlink-or-copy"}
    ],
    "mcpConfigPaths": [
      {"id": "codex-mcp", "path": "%APPDATA%/Codex/mcp.json", "format": "json", "managedSection": "enterpriseAgentHub"}
    ],
    "pluginTargets": [
      {"id": "codex-config-plugin", "path": "%APPDATA%/Codex/plugins.json", "format": "json"}
    ]
  },
  "safety": {
    "allowArbitraryWrite": false,
    "allowShellExecution": false,
    "dryRunRequired": true,
    "backupRequired": true
  }
}
```

### claude.adapter.json

```json
{
  "adapterId": "claude",
  "adapterVersion": "1.0.0",
  "toolName": "Claude",
  "supportedPlatforms": ["windows-x64"],
  "capabilities": {
    "supportsSkill": true,
    "supportsMcpConfigWrite": true,
    "supportsPluginInstall": true,
    "supportsSymlink": true,
    "supportsCopy": true,
    "supportsConfigWrite": true,
    "supportsControlledDownload": true,
    "supportsConnectionTest": true,
    "supportsRollback": true,
    "supportsDryRun": true,
    "supportedPluginInstallModes": ["CONFIG_PLUGIN", "MANUAL_DOWNLOAD"]
  },
  "detection": {
    "processNames": ["claude.exe", "Claude.exe"],
    "defaultInstallPaths": ["%LOCALAPPDATA%/Programs/Claude"],
    "configFiles": ["%APPDATA%/Claude/claude_desktop_config.json"]
  },
  "pathRules": {
    "skillTargets": [
      {"id": "claude-user-skills", "path": "%APPDATA%/Claude/skills", "mode": "symlink-or-copy"}
    ],
    "mcpConfigPaths": [
      {"id": "claude-desktop-mcp", "path": "%APPDATA%/Claude/claude_desktop_config.json", "format": "json", "managedSection": "mcpServers"}
    ],
    "pluginTargets": []
  },
  "safety": {
    "allowArbitraryWrite": false,
    "allowShellExecution": false,
    "dryRunRequired": true,
    "backupRequired": true
  }
}
```

### cursor.adapter.json

```json
{
  "adapterId": "cursor",
  "adapterVersion": "1.0.0",
  "toolName": "Cursor",
  "supportedPlatforms": ["windows-x64"],
  "capabilities": {
    "supportsSkill": true,
    "supportsMcpConfigWrite": true,
    "supportsPluginInstall": true,
    "supportsSymlink": true,
    "supportsCopy": true,
    "supportsConfigWrite": true,
    "supportsControlledDownload": true,
    "supportsConnectionTest": true,
    "supportsRollback": true,
    "supportsDryRun": true,
    "supportedPluginInstallModes": ["CONFIG_PLUGIN", "MANUAL_DOWNLOAD"]
  },
  "detection": {
    "processNames": ["Cursor.exe"],
    "defaultInstallPaths": ["%LOCALAPPDATA%/Programs/cursor"],
    "configFiles": ["%USERPROFILE%/.cursor/mcp.json"]
  },
  "pathRules": {
    "skillTargets": [
      {"id": "cursor-user-skills", "path": "%USERPROFILE%/.cursor/skills", "mode": "symlink-or-copy"}
    ],
    "mcpConfigPaths": [
      {"id": "cursor-mcp", "path": "%USERPROFILE%/.cursor/mcp.json", "format": "json", "managedSection": "mcpServers"}
    ],
    "pluginTargets": []
  },
  "safety": {
    "allowArbitraryWrite": false,
    "allowShellExecution": false,
    "dryRunRequired": true,
    "backupRequired": true
  }
}
```

### windsurf.adapter.json

```json
{
  "adapterId": "windsurf",
  "adapterVersion": "1.0.0",
  "toolName": "Windsurf",
  "supportedPlatforms": ["windows-x64"],
  "capabilities": {
    "supportsSkill": true,
    "supportsMcpConfigWrite": true,
    "supportsPluginInstall": true,
    "supportsSymlink": true,
    "supportsCopy": true,
    "supportsConfigWrite": true,
    "supportsControlledDownload": true,
    "supportsConnectionTest": true,
    "supportsRollback": true,
    "supportsDryRun": true,
    "supportedPluginInstallModes": ["CONFIG_PLUGIN", "MANUAL_DOWNLOAD"]
  },
  "detection": {
    "processNames": ["Windsurf.exe"],
    "defaultInstallPaths": ["%LOCALAPPDATA%/Programs/Windsurf"],
    "configFiles": ["%USERPROFILE%/.windsurf/mcp.json"]
  },
  "pathRules": {
    "skillTargets": [
      {"id": "windsurf-user-skills", "path": "%USERPROFILE%/.windsurf/skills", "mode": "symlink-or-copy"}
    ],
    "mcpConfigPaths": [
      {"id": "windsurf-mcp", "path": "%USERPROFILE%/.windsurf/mcp.json", "format": "json", "managedSection": "mcpServers"}
    ],
    "pluginTargets": []
  },
  "safety": {
    "allowArbitraryWrite": false,
    "allowShellExecution": false,
    "dryRunRequired": true,
    "backupRequired": true
  }
}
```

### opencode.adapter.json

```json
{
  "adapterId": "opencode",
  "adapterVersion": "1.0.0",
  "toolName": "opencode",
  "supportedPlatforms": ["windows-x64"],
  "capabilities": {
    "supportsSkill": true,
    "supportsMcpConfigWrite": true,
    "supportsPluginInstall": true,
    "supportsSymlink": true,
    "supportsCopy": true,
    "supportsConfigWrite": true,
    "supportsControlledDownload": true,
    "supportsConnectionTest": true,
    "supportsRollback": true,
    "supportsDryRun": true,
    "supportedPluginInstallModes": ["CONFIG_PLUGIN", "MANUAL_DOWNLOAD"]
  },
  "detection": {
    "processNames": ["opencode.exe"],
    "defaultInstallPaths": ["%LOCALAPPDATA%/Programs/opencode"],
    "configFiles": ["%APPDATA%/opencode/mcp.json"]
  },
  "pathRules": {
    "skillTargets": [
      {"id": "opencode-user-skills", "path": "%APPDATA%/opencode/skills", "mode": "symlink-or-copy"}
    ],
    "mcpConfigPaths": [
      {"id": "opencode-mcp", "path": "%APPDATA%/opencode/mcp.json", "format": "json", "managedSection": "mcpServers"}
    ],
    "pluginTargets": []
  },
  "safety": {
    "allowArbitraryWrite": false,
    "allowShellExecution": false,
    "dryRunRequired": true,
    "backupRequired": true
  }
}
```

### custom-directory.adapter.json

```json
{
  "adapterId": "custom-directory",
  "adapterVersion": "1.0.0",
  "toolName": "自定义目录",
  "supportedPlatforms": ["windows-x64"],
  "capabilities": {
    "supportsSkill": true,
    "supportsMcpConfigWrite": false,
    "supportsPluginInstall": false,
    "supportsSymlink": true,
    "supportsCopy": true,
    "supportsConfigWrite": false,
    "supportsControlledDownload": true,
    "supportsConnectionTest": false,
    "supportsRollback": true,
    "supportsDryRun": true,
    "supportedPluginInstallModes": ["MANUAL_DOWNLOAD"]
  },
  "detection": {
    "processNames": [],
    "defaultInstallPaths": [],
    "configFiles": []
  },
  "pathRules": {
    "skillTargets": [
      {"id": "custom-skill-dir", "path": "{userSelectedPath}", "mode": "symlink-or-copy"}
    ],
    "mcpConfigPaths": [],
    "pluginTargets": []
  },
  "safety": {
    "allowArbitraryWrite": false,
    "allowShellExecution": false,
    "dryRunRequired": true,
    "backupRequired": true
  }
}
```

注意：上述默认路径为 MVP 可落地占位设计，实际实现必须允许适配器在 `detect()` 中返回“未找到”“路径不存在”“不可写”“版本不兼容”等结果。任何路径写入前都必须 dry-run、备份、原子写和回滚。

### 内置适配器路径验证规则

上述路径不得被当成“已验证事实”。自动开发时每个内置适配器必须实现以下验证步骤：

| 步骤 | 输入 | 通过条件 | 失败处理 |
|---|---|---|---|
| 工具发现 | 进程名、安装目录、配置文件候选路径 | 至少命中一个可解释证据，如配置文件存在或可执行文件存在 | 返回 `tool_not_detected`，不写入任何文件 |
| 版本识别 | 可执行文件版本、配置 schema 或用户提供版本 | 满足 adapter manifest 的 `supportedTargetVersions` 或未声明版本约束 | 返回 `tool_version_incompatible` |
| 配置路径确认 | manifest 默认路径、用户覆盖路径 | 路径在允许根目录下，父目录存在或可安全创建 | 返回 `target_path_not_found` 或 `target_path_not_writable` |
| dry-run | 待写配置摘要、文件操作计划 | 所有写入步骤可获得权限，备份目录可写 | 返回 `execution_plan_invalid` 或具体本地错误码 |
| 备份验证 | 原文件 Hash、备份文件 Hash | 备份成功且 Hash 匹配 | 返回 `backup_failed`，禁止继续写入 |

适配器实现不得把 `defaultInstallPaths` 和 `configFiles` 作为强制路径。企业内部实际工具安装位置可能被 IT 策略改写，客户端必须允许管理员或用户在本地工具设置中显式指定路径。显式路径仍需满足白名单变量展开、dry-run、备份和回滚规则。


## 8.11 ToolAdapterRegistry

```ts
class ToolAdapterRegistry {
  register(adapter: ToolAdapter): void;
  get(adapterId: string): ToolAdapter;
  list(): ToolAdapter[];
  detectAll(): Promise<DetectedTool[]>;
}
```

启动时注册内置适配器：

- Codex；
- Claude；
- Cursor；
- Windsurf；
- opencode；
- 自定义目录。

自定义目录适配器只支持用户显式配置路径，不扫描全盘。

## 8.12 MCP 配置写入策略

MCP 写入必须生成托管配置项 ID：

```json
{
  "managedBy": "EnterpriseAgentHub",
  "managedConfigId": "eah_mcp_finance_mcp_server_codex_001",
  "extensionId": "finance-mcp-server",
  "version": "1.0.0"
}
```

卸载时只删除带有该托管 ID 的配置项，不删除用户手写配置。

### 配置模板渲染

输入：

```ts
interface McpTemplateRenderInput {
  definition: McpDefinition;
  variables: Record<string, string | number | boolean>;
  secretRefs: Record<string, SecretRef>;
  targetTool: DetectedTool;
}
```

输出：

```ts
interface RenderedMcpConfig {
  redactedPreview: unknown;
  fullConfigRef: string;
  managedConfigId: string;
}
```

`redactedPreview` 用于展示和日志；`fullConfigRef` 指向执行器内存或临时加密文件，不应写入普通日志。

## 8.13 local-command 安全规则

MCP local-command 连接检测和配置写入必须遵循：

1. 不使用 shell，`spawn(command, args, { shell: false })`。
2. command 和 args 来自审核通过的定义清单。
3. 用户填写变量只做模板替换，替换后重新校验。
4. 高风险执行器如 `cmd`、`powershell`、`bash`、`sh`、`curl`、`wget`、下载后执行语义，服务端审核中标高风险；客户端不额外绕过审核。
5. connectionTest 只能做命令存在性、版本读取、只读健康检查或 Tool Adapter 安全检测。
6. 超时必须可配置，默认较短。
7. stdout/stderr 进入日志前脱敏和截断。

## 8.14 Plugin 安装清单执行

MVP 支持有限 action：

```ts
type PluginManifestAction =
  | { action: 'copy'; from: string; to: 'tool-plugin-dir' | 'controlled-plugin-dir' | string }
  | { action: 'remove'; target: string }
  | { action: 'write-json'; target: string; jsonPointer: string; value: unknown }
  | { action: 'upsert-json'; target: string; jsonPointer: string; value: unknown }
  | { action: 'create-dir'; target: string }
  | { action: 'verify-hash'; target: string; sha256: string }
  | { action: 'mark-state'; state: string };
```

禁止：

- 任意脚本；
- 任意 shell；
- 下载后执行；
- 写入 adapter 未声明的系统目录；
- 删除 adapter 未管理路径。

## 8.15 PlanValidator

`PlanValidator` 负责在执行前阻断危险计划：

- 路径必须规范化。
- 目标路径不能逃逸允许根目录，除非来自 Tool Adapter 检测出的明确配置路径。
- 不允许 Windows 系统目录、用户主目录根、磁盘根作为删除目标。
- remove-path 必须带 backup 或明确是托管项。
- JSON 修改必须有备份。
- write-file-atomic 不能写入日志目录中的敏感文件。
- Step 数量、总写入大小受限。
- 计划中的 secret value 不得序列化到 plan_json。

## 8.16 事件生成

本地执行结果必须生成事件：

| 操作 | 成功事件 | 失败事件 |
|---|---|---|
| Skill 安装 | SKILL_INSTALL | SKILL_INSTALL_FAILED |
| Skill 启用 | SKILL_ENABLE | SKILL_ENABLE_FAILED |
| MCP 写入 | MCP_CONFIG_WRITE | MCP_CONFIG_WRITE_FAILED |
| MCP 连接检测 | MCP_CONNECTION_TEST | MCP_CONNECTION_TEST_FAILED |
| Plugin 安装 | PLUGIN_INSTALL | PLUGIN_INSTALL_FAILED |
| 回滚 | ROLLBACK_SUCCESS | ROLLBACK_FAILED |
| symlink 降级 | SYMLINK_FALLBACK_COPY | - |
| 部分成功 | PARTIAL_SUCCESS | - |

事件 payload 只记录摘要：

```json
{
  "targetCount": 3,
  "successCount": 2,
  "failureCount": 1,
  "errorCodes": ["path_not_writable"],
  "pathsMasked": ["C:/Users/***/..."]
}
```

## 8.17 自动测试建议

必须为本地执行器建立高覆盖测试：

1. 临时目录下安装、启用、卸载 Skill。
2. symlink 不可用时降级 copy。
3. JSON 配置写入失败后回滚。
4. 多目标部分成功。
5. managed-package 安装失败后恢复旧版本。
6. 删除操作不允许删除根目录。
7. secret value 不出现在 plan_json 和日志中。
8. 同一执行结果重复同步不会重复统计。
