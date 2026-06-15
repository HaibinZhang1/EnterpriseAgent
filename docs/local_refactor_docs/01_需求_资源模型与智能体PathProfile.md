# 需求 1：本地资源模型与 Agent Path Profile

> 目标：建立本地页重构的底层模型和智能体适配规则，解决“资源怎么统一建模”“资源分布怎么表达”“9 个智能体如何真实扫描”“状态怎么聚合展示”“现有模块怎么迁移落地”等问题。

---

## 1. 范围

本需求覆盖：

```text
LocalResource
ResourceBinding
FileBackedResource
AgentAdapter / ToolAdapter 扩展
AgentPathProfile
9 个内置智能体 + 自定义目录
macOS / Windows 双端路径规则
状态聚合优先级
权限摘要模型
现有模块迁移落点
CLI 版本信息读取边界
```

不覆盖具体页面布局，页面要求见 `02_需求_页面与资源管理.md`。

---

## 2. 统一资源模型

### 2.1 LocalResource

`LocalResource` 表示资源本体，只回答“这是什么资源”。它不表达该资源应用到哪里。

```ts
interface LocalResource {
  id: string;
  type: LocalResourceType;
  name: string;
  displayName: string;
  description?: string;

  sourceType: LocalResourceSourceType;
  sourceId?: string;
  sourcePath?: string;

  version?: string;
  latestVersion?: string;
  sha256?: string;
  packageHash?: string;

  managed: boolean;
  centralStoreManaged: boolean;
  nativeDirectoryManaged: boolean;
  eaManagedFallback: boolean;

  permissionSummary: PermissionSummary;
  auditSummary: AuditSummary;

  createdAt: string;
  lastScannedAt?: string;
  lastModifiedAt?: string;
  lastEventAt?: string;

  metadata: Record<string, unknown>;
}
```

### 2.2 ResourceBinding

`ResourceBinding` 表示资源分布和作用域，只回答“这个资源应用到了哪里”。一个资源可以绑定到多个智能体、项目或 Kit。

```ts
interface ResourceBinding {
  id: string;
  resourceId: string;
  resourceType: LocalResourceType;

  agentId?: string;
  projectId?: string;
  kitId?: string;

  scopeType: ResourceScopeType;
  scopePath?: string;
  targetPath?: string;

  managedMode: ManagedMode;
  writeMode: WriteMode;

  detectionStatus: DetectionStatus;
  lifecycleStatus: LifecycleStatus;
  pathStatus: PathStatus;
  authStatus: AuthStatus;
  auditStatus: AuditStatus;
  driftStatus: DriftStatus;
  operationStatus: OperationStatus;
  syncStatus: SyncStatus;

  lastKnownHash?: string;
  currentHash?: string;
  externalModified: boolean;
  drifted: boolean;

  backupSnapshotId?: string;
  lastExecutionId?: string;
  lastEventAt?: string;

  metadata: Record<string, unknown>;
}
```

### 2.3 FileBackedResource

文件型资源必须独立记录路径、Hash、mtime、大小、漂移、预览和备份快照。

```ts
interface FileBackedResource {
  resourceId: string;
  bindingId: string;
  path: string;
  contentType: 'json' | 'toml' | 'yaml' | 'markdown' | 'text' | 'script' | 'binary' | 'unknown';
  size: number;
  lastKnownMtime: string;
  lastKnownSize: number;
  lastKnownHash: string;
  currentHash?: string;
  lastManagedHash?: string;
  externalModified: boolean;
  drifted: boolean;
  previewAvailable: boolean;
  backupSnapshotId?: string;
}
```

---

## 3. 枚举

### 3.1 LocalResourceType

```text
AGENT
AGENT_CONFIG
RULE
MEMORY
SUBAGENT
IGNORE_FILE
SKILL
MCP_SERVER
PLUGIN
HOOK
CLI_COMMAND
KIT
PROJECT
AUDIT_FINDING
LOCAL_EVENT
```

禁止使用旧 Agent-first CLI 概念。CLI 统一为 `CLI_COMMAND`。

### 3.2 LocalResourceSourceType

```text
CENTRAL_STORE
NATIVE_AGENT_DIRECTORY
PROJECT_DIRECTORY
CUSTOM_DIRECTORY
EA_MANAGED_FALLBACK
KIT
LOCAL_IMPORT
MANUAL_RECORD
EXTERNAL_DISCOVERY
SERVER_CACHE
```

### 3.3 ResourceScopeType

```text
GLOBAL
AGENT_GLOBAL
PROJECT
AGENT_PROJECT
CUSTOM_PATH
KIT
```

### 3.4 ManagedMode

```text
SERVER_MANAGED
LOCAL_MANAGED
EA_MANAGED
NATIVE_MANAGED
MANUAL_RECORD_ONLY
EXTERNAL_DISCOVERY_ONLY
```

### 3.5 WriteMode

```text
READ_ONLY
NATIVE_FILE_WRITE
MANAGED_BLOCK_WRITE
CENTRAL_STORE_LINK
CENTRAL_STORE_COPY
EA_MANAGED_FILE_WRITE
MANUAL_RECORD_UPDATE
```

---

## 4. 状态模型与列表状态优先级

底层状态必须拆分，不得混入单字段：

```text
DetectionStatus
LifecycleStatus
PathStatus
AuthStatus
AuditStatus
DriftStatus
OperationStatus
SyncStatus
```

### 4.1 状态枚举

```text
DetectionStatus:
UNKNOWN / DETECTED / NOT_DETECTED / NOT_CONFIGURED / SCAN_FAILED

LifecycleStatus:
UNKNOWN / INSTALLED / ENABLED / DISABLED / CONNECTED / RECORDED / UNINSTALLED / REMOVED

PathStatus:
UNKNOWN / OK / MISSING / NOT_WRITABLE / INVALID / CONFLICT

AuthStatus:
UNKNOWN / AUTHORIZED / AUTH_CACHE_VALID / AUTH_REVOKED / SECURITY_DELISTED / DELISTED / OFFLINE_UNKNOWN

AuditStatus:
NOT_AUDITED / SAFE / LOW_RISK / NEEDS_REVIEW / HIGH_RISK / SECURITY_RISK

DriftStatus:
UNKNOWN / NOT_DRIFTED / DRIFTED / EXTERNALLY_MODIFIED / MANAGED_BLOCK_MISSING / HASH_CHANGED

OperationStatus:
IDLE / RUNNING / SUCCESS / FAILURE / PARTIAL_SUCCESS / ROLLED_BACK / ROLLBACK_FAILED

SyncStatus:
LOCAL_ONLY / PENDING_SYNC / SYNCED / SYNC_FAILED / SERVER_REJECTED
```

### 4.2 列表“状态”聚合优先级

列表只有一个“状态”列时，按以下优先级展示，不得让“已启用”覆盖安全或失败状态：

| 优先级 | 状态来源 | 展示建议 |
|---:|---|---|
| 1 | `AuthStatus.SECURITY_DELISTED` | 安全下架 |
| 2 | `AuthStatus.AUTH_REVOKED` | 授权收缩 |
| 3 | `OperationStatus.ROLLBACK_FAILED` | 回滚失败 |
| 4 | `OperationStatus.FAILURE` | 操作失败 |
| 5 | `OperationStatus.PARTIAL_SUCCESS` | 部分成功 |
| 6 | `AuditStatus.SECURITY_RISK` | 安全风险 |
| 7 | `AuditStatus.HIGH_RISK` | 高风险 |
| 8 | `PathStatus.MISSING / NOT_WRITABLE / INVALID / CONFLICT` | 路径异常 |
| 9 | `DriftStatus.DRIFTED / EXTERNALLY_MODIFIED / MANAGED_BLOCK_MISSING / HASH_CHANGED` | 配置漂移 |
| 10 | `SyncStatus.PENDING_SYNC / SYNC_FAILED / SERVER_REJECTED` | 待同步 / 同步失败 |
| 11 | `DetectionStatus.SCAN_FAILED` | 扫描失败 |
| 12 | `LifecycleStatus.ENABLED / INSTALLED / CONNECTED` | 已启用 / 已安装 / 已接入 |
| 13 | `DetectionStatus.NOT_DETECTED / NOT_CONFIGURED` | 未检测 / 未配置 |
| 14 | 默认 | 未知 |

---

## 5. 权限摘要模型

权限维度采用 HarnessKit 式五大维度，并增加 EnterpriseAgent 企业维度：

```text
FILESYSTEM
NETWORK
SHELL
DATABASE
ENVIRONMENT
CONFIG_WRITE
SECRET
PROCESS
INTEGRITY
CUSTOM_PATH
```

具体权限项：

```text
FILE_READ
FILE_WRITE
PROJECT_READ
PROJECT_WRITE
CONFIG_WRITE
NETWORK_DOMAIN
SHELL_COMMAND
ENV_READ
ENV_WRITE
SECRET_ACCESS
DATABASE_CONNECTION
PROCESS_ACCESS
CUSTOM_PATH_ACCESS
HASH_INTEGRITY
```

列表中只显示摘要，例如：

```text
文件+命令
网络+环境变量
配置写入
文件+网络+命令
数据库+Secret
```

详情中必须展开路径、域名、命令、变量名、数据库引擎、配置文件、规则编号、风险等级和建议动作。敏感值不得明文展示。

---

## 6. Agent Adapter / Tool Adapter 扩展

UI 统一称“智能体”。技术实现可以沿用现有 Tool Adapter 命名，但能力模型必须升级为完整 Agent Adapter。

不得新建一套与现有 ToolAdapter、LocalExecutor、ExecutionPlan、BackupStore、RollbackManager、SecureStore 割裂的数据结构。

### 6.1 AgentAdapterManifest

```ts
interface AgentAdapterManifest {
  agentId: string;
  displayName: string;
  adapterVersion: string;
  supportedPlatforms: Array<'macos' | 'windows'>;

  builtIn: boolean;
  customProfileSupported: boolean;

  detectSupported: boolean;
  globalScopeSupported: boolean;
  projectScopeSupported: boolean;
  customPathSupported: boolean;

  settingsSupported: boolean;
  settingsReadSupported: boolean;
  settingsWriteSupported: boolean;
  ignoreFileSupported: boolean;
  filePreviewSupported: boolean;
  fileWatchSupported: boolean;

  rulesSupported: boolean;
  memorySupported: boolean;
  subagentsSupported: boolean;

  skillSupported: boolean;
  mcpSupported: boolean;
  pluginSupported: boolean;
  hookSupported: boolean;
  cliSupported: boolean;

  symlinkSupported: boolean;
  copySupported: boolean;
  configWriteSupported: boolean;
  nativeDirectoryWriteSupported: boolean;
  managedDownloadSupported: boolean;
  commandRegisterSupported: boolean;

  connectionCheckSupported: boolean;
  permissionExtractSupported: boolean;
  staticAuditSupported: boolean;
  secretScanSupported: boolean;
  backupSupported: boolean;
  rollbackSupported: boolean;

  macosPathProfile: AgentPathProfile;
  windowsPathProfile: AgentPathProfile;
}
```

### 6.2 AgentAdapter 方法

```ts
interface AgentAdapter {
  manifest: AgentAdapterManifest;

  detectAgents(input: DetectAgentInput): Promise<DetectedAgent[]>;
  readPathProfile(input: PathProfileInput): Promise<AgentPathProfile>;

  scanSettings(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanRules(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanMemory(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanSubagents(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanIgnoreFiles(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanSkills(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanMcpServers(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanPlugins(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanHooks(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;
  scanCliCommands(input: AgentScopeInput): Promise<LocalResourceScanResult[]>;

  extractPermissions(input: PermissionExtractInput): Promise<PermissionSummary>;
  buildStaticAuditInput(input: StaticAuditBuildInput): Promise<StaticAuditInput>;

  buildWritePlan(input: AgentResourceWriteInput): Promise<ExecutionPlan>;
  buildDisablePlan(input: AgentResourceDisableInput): Promise<ExecutionPlan>;
  buildRemovePlan(input: AgentResourceRemoveInput): Promise<ExecutionPlan>;
  buildRestorePlan(input: AgentResourceRestoreInput): Promise<ExecutionPlan>;

  watchFiles?(input: FileWatchInput): Promise<FileWatchSubscription>;
  runMcpConnectionCheck?(input: McpConnectionCheckInput): Promise<McpConnectionCheckResult>;
}
```

`runMcpConnectionCheck` 只能用于授权允许的 HTTP/SSE/Streamable HTTP 网络检测。stdio / command MCP 不得通过该方法启动本地进程。

---

## 7. EA-managed fallback path

部分智能体没有公开某类原生资源路径，或者某能力只存在 UI 设置而非稳定文件结构。为保证自定义目录和 9 个内置智能体 Dashboard 结构一致，EnterpriseAgent 必须提供受控补充目录。

### 7.1 全局 fallback

```text
macOS:
${HOME}/.enterprise-agent/local/<agentId>/

Windows:
%USERPROFILE%\.enterprise-agent\local\<agentId>\
```

### 7.2 项目 fallback

```text
<project>/.enterprise-agent/local/<agentId>/
```

### 7.3 子目录规范

```text
settings/
rules/
memory/
subagents/
ignore/
skills/
mcp/
plugins/
hooks/
cli/
kits/
backups/
```

fallback 目录是 EnterpriseAgent 明确定义的真实受控目录，不是 placeholder。写入 fallback 目录同样必须走 ExecutionPlan、备份、Hash、回滚、事件和静态审计。

---

## 8. 9 个内置智能体 Path Profile 基线

### 8.1 路径来源级别

| 来源级别 | 说明 |
|---|---|
| `OFFICIAL_VERIFIED` | 官方文档明确说明路径。 |
| `PRODUCT_DOC_UNSTRUCTURED` | 官方文档存在，但当前无法稳定提取结构化行号；实现时必须二次验证。 |
| `DOC_OR_COMMUNITY_VERIFIED` | 产品文档、官方博客、社区文档或主流实践明确，但不是完整官方路径表。 |
| `EA_MANAGED` | EnterpriseAgent 定义的受控补充路径。 |
| `NOT_APPLICABLE` | 产品当前未公开或原生不支持该类资源。 |
| `USER_CONFIG_REQUIRED` | 自定义目录或用户提供路径。 |

### 8.2 macOS / Windows 通用变量

```text
${HOME}                macOS 用户主目录
%USERPROFILE%          Windows 用户主目录
<project>              用户登记或扫描到的项目根目录
<agentId>              claude-code / codex / gemini-cli / cursor / antigravity / copilot / windsurf / opencode / hermes
```

### 8.3 Path Profile 表

| Agent | 平台 | 检测根 | 全局资源路径 | 项目资源路径 | MCP / Hook / CLI / Plugin 重点路径 | 来源级别 |
|---|---|---|---|---|---|---|
| Claude Code | macOS | `${HOME}/.claude` | `${HOME}/.claude/settings.json`、`${HOME}/.claude/CLAUDE.md`、`${HOME}/.claude/rules/*.md`、`${HOME}/.claude/skills/*/SKILL.md`、`${HOME}/.claude/commands/*.md`、`${HOME}/.claude/agents/*.md`、`${HOME}/.claude/plugins/`、`${HOME}/.claude/projects/<project>/memory/` | `<project>/CLAUDE.md`、`<project>/.claude/settings.json`、`<project>/.claude/settings.local.json`、`<project>/.claude/rules/*.md`、`<project>/.claude/skills/*/SKILL.md`、`<project>/.claude/commands/*.md`、`<project>/.claude/agents/*.md`、`<project>/.mcp.json`、`<project>/.worktreeinclude` | Hook 在 `settings.json` 的 hooks 配置；MCP 项目配置在 `.mcp.json`；个人 MCP / App state 读取 `${HOME}/.claude.json`；CLI_COMMAND 来自 hooks、MCP command、commands 及 EA-managed `cli/` | `OFFICIAL_VERIFIED` |
| Claude Code | Windows | `%USERPROFILE%\.claude` | `%USERPROFILE%\.claude\settings.json`、`%USERPROFILE%\.claude\CLAUDE.md`、`%USERPROFILE%\.claude\rules\*.md`、`%USERPROFILE%\.claude\skills\*\SKILL.md`、`%USERPROFILE%\.claude\commands\*.md`、`%USERPROFILE%\.claude\agents\*.md`、`%USERPROFILE%\.claude\plugins\`、`%USERPROFILE%\.claude\projects\<project>\memory\` | `<project>\CLAUDE.md`、`<project>\.claude\settings.json`、`<project>\.claude\settings.local.json`、`<project>\.claude\rules\*.md`、`<project>\.claude\skills\*\SKILL.md`、`<project>\.claude\commands\*.md`、`<project>\.claude\agents\*.md`、`<project>\.mcp.json`、`<project>\.worktreeinclude` | 同 macOS；`~/.claude` 在 Windows 解析为 `%USERPROFILE%\.claude` | `OFFICIAL_VERIFIED` |
| Codex | macOS | `${HOME}/.codex` | `${HOME}/.codex/config.toml`、`${HOME}/.codex/AGENTS.md`、`${HOME}/.codex/<profile>.config.toml` | `<project>/.codex/config.toml`、`<project>/AGENTS.md`、`<project>/AGENTS.override.md`、按 `project_doc_fallback_filenames` 识别的备用说明文件 | MCP / approval / sandbox / profile 配置在 `config.toml`；Hook / Rule 以 Codex 配置层和项目说明文件为主；Skill / Plugin / CLI 使用 EA-managed fallback，除非用户配置额外原生路径 | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Codex | Windows | `%USERPROFILE%\.codex` | `%USERPROFILE%\.codex\config.toml`、`%USERPROFILE%\.codex\AGENTS.md`、`%USERPROFILE%\.codex\<profile>.config.toml` | `<project>\.codex\config.toml`、`<project>\AGENTS.md`、`<project>\AGENTS.override.md`、备用说明文件 | 同 macOS；支持 `CODEX_HOME` 覆盖根目录，检测器必须识别该环境变量但不得执行 Codex | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Gemini CLI | macOS | `${HOME}/.gemini` | `${HOME}/.gemini/settings.json`、`${HOME}/.gemini/GEMINI.md`、`${HOME}/.gemini/commands/*.toml` | `<project>/.gemini/settings.json`、`<project>/GEMINI.md`、`<project>/.gemini/commands/*.toml` | MCP 在 `settings.json.mcpServers` / `mcp`；自定义命令在 `commands/*.toml`；扩展 manifest 和敏感设置按 Gemini extension 机制识别；Skill / Subagent / Plugin 缺省使用 EA-managed fallback | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Gemini CLI | Windows | `%USERPROFILE%\.gemini` | `%USERPROFILE%\.gemini\settings.json`、`%USERPROFILE%\.gemini\GEMINI.md`、`%USERPROFILE%\.gemini\commands\*.toml` | `<project>\.gemini\settings.json`、`<project>\GEMINI.md`、`<project>\.gemini\commands\*.toml` | 同 macOS | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Cursor | macOS | `<project>/.cursor`、`${HOME}/.cursor` | 用户规则主要由 Cursor 设置管理；如存在 `${HOME}/.cursor/mcp.json` 可作为全局 MCP 发现；全局 Settings 不做强写入，除非用户配置路径 | `<project>/.cursor/rules/*.mdc`、`<project>/.cursor/mcp.json`、`<project>/.cursorrules` legacy | MCP 以 `.cursor/mcp.json` 为主；Rules 以 `.cursor/rules/*.mdc` 为主；Memory / Subagent / Hook / CLI / Plugin 缺省使用 EA-managed fallback 或用户自定义 Path Profile | `PRODUCT_DOC_UNSTRUCTURED + DOC_OR_COMMUNITY_VERIFIED + EA_MANAGED` |
| Cursor | Windows | `<project>\.cursor`、`%USERPROFILE%\.cursor` | 同 macOS，Windows 路径替换为反斜杠 | `<project>\.cursor\rules\*.mdc`、`<project>\.cursor\mcp.json`、`<project>\.cursorrules` | 同 macOS | `PRODUCT_DOC_UNSTRUCTURED + DOC_OR_COMMUNITY_VERIFIED + EA_MANAGED` |
| Antigravity | macOS | `${HOME}/.gemini`、`<project>/.agent`、`<project>/.agents` | `${HOME}/.gemini/GEMINI.md`、`${HOME}/.gemini/antigravity/global_workflows/*.md` | `<project>/.agent/rules/`、`<project>/.agent/workflows/`、`<project>/AGENTS.md`、`<project>/.agents/skills/*/SKILL.md` | Rules / Workflows 以 `.agent/` 和 `~/.gemini` 为主；Skills 可识别 `.agents/skills/`；本地 IDE 其他配置缺省使用 EA-managed fallback | `DOC_OR_COMMUNITY_VERIFIED + OFFICIAL_VERIFIED + EA_MANAGED` |
| Antigravity | Windows | `%USERPROFILE%\.gemini`、`<project>\.agent`、`<project>\.agents` | `%USERPROFILE%\.gemini\GEMINI.md`、`%USERPROFILE%\.gemini\antigravity\global_workflows\*.md` | `<project>\.agent\rules\`、`<project>\.agent\workflows\`、`<project>\AGENTS.md`、`<project>\.agents\skills\*\SKILL.md` | 同 macOS | `DOC_OR_COMMUNITY_VERIFIED + OFFICIAL_VERIFIED + EA_MANAGED` |
| Copilot | macOS | `<project>/.github`、`<project>/.vscode`、VS Code user profile | 组织级和用户级指令由 GitHub / VS Code 管理；本地页默认只读发现，不强写用户 profile，除非用户配置 | `<project>/.github/copilot-instructions.md`、`<project>/.github/instructions/*.instructions.md`、`<project>/AGENTS.md`、`<project>/CLAUDE.md`、`<project>/.vscode/mcp.json` | MCP 工作区配置为 `.vscode/mcp.json`；用户 profile mcp.json 可通过 VS Code 命令打开，默认只做外部发现；Hook / CLI / Skill / Plugin 使用 EA-managed fallback | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Copilot | Windows | `<project>\.github`、`<project>\.vscode`、VS Code user profile | 同 macOS | `<project>\.github\copilot-instructions.md`、`<project>\.github\instructions\*.instructions.md`、`<project>\AGENTS.md`、`<project>\CLAUDE.md`、`<project>\.vscode\mcp.json` | 同 macOS | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Windsurf | macOS | `<project>/.windsurf` | 全局规则通过 Windsurf / Cascade 设置管理；如用户配置全局路径则纳入扫描 | `<project>/.windsurf/rules/` | Memories 由 Cascade 工作区管理；本地页可发现规则目录和用户配置的 memory 导出路径；Skill / MCP / Plugin / Hook / CLI 使用 EA-managed fallback | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Windsurf | Windows | `<project>\.windsurf` | 同 macOS | `<project>\.windsurf\rules\` | 同 macOS | `OFFICIAL_VERIFIED + EA_MANAGED` |
| OpenCode | macOS | `${HOME}/.config/opencode`、`<project>/.opencode` | `${HOME}/.config/opencode/opencode.json`、`${HOME}/.config/opencode/AGENTS.md`、`${HOME}/.config/opencode/skills/*/SKILL.md`、`${HOME}/.opencode.json` legacy | `<project>/AGENTS.md`、`<project>/CLAUDE.md` fallback、`<project>/.opencode/opencode.json`、`<project>/.opencode/skills/*/SKILL.md`、`<project>/.claude/skills/*/SKILL.md`、`<project>/.agents/skills/*/SKILL.md` | 支持 `OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR`；agents / commands / modes / plugins 从 config dir 发现；MCP / Plugin / Hook 按 opencode.json 和 EA-managed fallback | `OFFICIAL_VERIFIED + EA_MANAGED` |
| OpenCode | Windows | `%USERPROFILE%\.config\opencode`、`<project>\.opencode` | `%USERPROFILE%\.config\opencode\opencode.json`、`%USERPROFILE%\.config\opencode\AGENTS.md`、`%USERPROFILE%\.config\opencode\skills\*\SKILL.md`、`%USERPROFILE%\.opencode.json` legacy | `<project>\AGENTS.md`、`<project>\CLAUDE.md` fallback、`<project>\.opencode\opencode.json`、`<project>\.opencode\skills\*\SKILL.md`、`<project>\.claude\skills\*\SKILL.md`、`<project>\.agents\skills\*\SKILL.md` | 同 macOS；Windows 实际 XDG 目录可由环境变量覆盖，检测器必须支持用户配置 | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Hermes | macOS | `${HOME}/.hermes` | `${HOME}/.hermes/config.yaml`、`${HOME}/.hermes/.env`、`${HOME}/.hermes/auth.json`、`${HOME}/.hermes/SOUL.md`、`${HOME}/.hermes/memories/`、`${HOME}/.hermes/skills/`、`${HOME}/.hermes/cron/` | `<project>/AGENTS.md`、`<project>/SOUL.md`、`<project>/.cursorrules`、项目 persistent memory 由 Hermes 配置和 cwd/profile 解析 | Secrets 在 `.env`；非 secret 在 `config.yaml`；CLI 支持 `--ignore-rules`，本地页只静态读取配置，不启动 Hermes | `OFFICIAL_VERIFIED + EA_MANAGED` |
| Hermes | Windows | `%USERPROFILE%\.hermes` | `%USERPROFILE%\.hermes\config.yaml`、`%USERPROFILE%\.hermes\.env`、`%USERPROFILE%\.hermes\auth.json`、`%USERPROFILE%\.hermes\SOUL.md`、`%USERPROFILE%\.hermes\memories\`、`%USERPROFILE%\.hermes\skills\`、`%USERPROFILE%\.hermes\cron\` | `<project>\AGENTS.md`、`<project>\SOUL.md`、`<project>\.cursorrules` | 同 macOS | `OFFICIAL_VERIFIED + EA_MANAGED` |

### 8.4 Path Profile 验收要求

- 9 个内置智能体在 macOS 和 Windows 都必须可展示。
- 每个智能体必须有真实检测根；没有原生路径的资源必须落到 EA-managed fallback 或显示 `NOT_APPLICABLE`。
- 不得用空字符串、TODO、placeholder path、随机路径通过验收。
- Path Profile 必须支持用户覆盖。例如 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`OPENCODE_CONFIG_DIR`、自定义目录 Profile。
- 文件监听失败必须降级为周期扫描或手动重新扫描，并生成本地事件。
- 路径不可写时不得执行写入，必须在 ExecutionPlan 预检阶段失败。

---

## 9. 自定义目录 Agent Profile

自定义目录用于用户补充市面上尚未被本项目内置的智能体。它不是低配目录。

```ts
interface CustomAgentProfile {
  profileId: string;
  displayName: string;
  supportedPlatforms: Array<'macos' | 'windows'>;
  rootPaths: string[];
  pathProfile: AgentPathProfile;
  capabilities: AgentAdapterCapabilitySet;
  createdByUser: boolean;
  lastValidatedAt?: string;
}
```

规则：

1. 用户必须至少配置一个根目录。
2. 用户可配置全局配置、项目配置、Rules、Memory、Subagents、Ignore、Skill、MCP、Plugin、Hook、CLI 路径规则。
3. 自定义目录所有写入必须生成 ExecutionPlan。
4. 静态审计、备份、回滚、本地事件、离线能力与内置智能体一致。
5. 未配置某类路径规则时显示“未配置路径规则”，不得显示“不支持”。

---

## 10. 现有模块迁移落点表

| 现有模块 / 能力 | 新职责 | 复用策略 | 注意事项 |
|---|---|---|---|
| ToolAdapter | 扩展为 AgentAdapter 能力声明和 Path Profile 扫描 | 复用并扩展 | UI 叫智能体，技术命名可保持 ToolAdapter。 |
| Local extension model | 映射为 LocalResource + ResourceBinding | 迁移 | 不允许只保留旧 Skill/MCP/Plugin 三类模型。 |
| Central Store | Skill 和 managed-package Plugin 的受控包存储 | 复用 | Settings、Rules、Memory、Hook、CLI 不进 Central Store。 |
| SecureStore | MCP、Plugin、Hook、CLI 涉及的敏感变量引用 | 复用 | UI 和事件只显示变量名、引用、脱敏片段。 |
| LocalExecutor | 执行 ExecutionPlan 的文件和配置写入动作 | 复用并收缩 | 禁止 shell-command、execute-cli、trigger-hook。 |
| ExecutionPlan | 所有危险写入前的影响摘要和预检 | 扩展 | 覆盖 Rules、Memory、Subagent、Ignore、Hook、CLI、Kit。 |
| BackupStore | 文件和配置快照 | 扩展 | 记录旧内容、Hash、mtime、权限和托管块边界。 |
| RollbackManager | 回滚已写入目标 | 扩展 | 回滚失败必须可见，生成事件。 |
| Audit service | 静态审计和 Trust Score | 扩展 | 覆盖全部资源类型，不只扩展。 |
| LocalEvent | 统一本地事件源 | 扩展 | 概览、智能体、项目、工具集、审计页必须读取同一事件源。 |
| Project registry | 项目作用域和项目路径状态 | 复用并扩展 | 删除项目不得删除真实项目目录。 |
| Offline sync queue | 离线事件入队和联网同步 | 复用并扩展 | 使用 idempotencyKey 去重。 |

---

## 11. CLI 版本信息读取需求

### 11.1 允许方式

- 读取 Central Store / Kit / Plugin manifest 中的版本。
- 读取文件属性、签名信息、Hash、mtime、包管理器本地索引或 OS 注册表。
- 读取用户手动登记版本。
- 读取上次服务端同步版本。

### 11.2 禁止方式

- 执行 `xxx --version`、`xxx -v`。
- 通过 bash、sh、cmd、PowerShell 执行任何命令。
- 启动 CLI 后解析 stdout/stderr。
- 为了检测版本调用 Hook、Plugin lifecycle script、MCP command。

### 11.3 UI 表达

```text
版本：1.2.3
来源：manifest
```

或：

```text
版本：未知
原因：未发现 manifest / 禁止执行 CLI 读取版本
```

---

## 12. 本需求验收标准

- [ ] 所有资源可映射为 LocalResource。
- [ ] 所有资源分布可映射为 ResourceBinding。
- [ ] 所有文件型资源可映射为 FileBackedResource。
- [ ] 9 个智能体均有 macOS / Windows Path Profile。
- [ ] 每个 Path Profile 都有真实检测根、项目路径规则和 fallback 规则。
- [ ] 不存在空 path、TODO path、placeholder path。
- [ ] 自定义目录 Profile 与内置智能体能力一致。
- [ ] 状态模型拆分为检测、生命周期、路径、授权、审计、漂移、操作、同步。
- [ ] 列表状态聚合按安全和失败优先。
- [ ] 现有 ToolAdapter、Central Store、LocalExecutor、BackupStore、RollbackManager、LocalEvent 被复用或扩展，不另起炉灶。
- [ ] CLI 版本信息读取不执行命令。
- [ ] 运行时无 mock、demo、placeholder、随机数据或默认成功状态。
