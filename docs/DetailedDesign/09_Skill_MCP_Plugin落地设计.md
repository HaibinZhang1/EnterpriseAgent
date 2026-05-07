# 09. Skill、MCP Server、Plugin 落地设计

## 9.1 通用扩展 DTO

```ts
interface ExtensionIdentity {
  id: string;
  extensionId: string;
  type: 'SKILL' | 'MCP_SERVER' | 'PLUGIN';
  name: string;
  version: string;
}

interface ExtensionPermission {
  canViewDetail: boolean;
  canInstall: boolean;
  canDownload: boolean;
  canCopyConfig: boolean;
  canWriteConfig: boolean;
  canEnableNewTarget: boolean;
  canUpdate: boolean;
  canConnectionTest: boolean;
  reasonCode?: string;
  reasonText?: string;
}

interface LocalExtensionState {
  extensionId: string;
  type: ExtensionType;
  localVersion?: string;
  latestVersion?: string;
  status:
    | 'NOT_INSTALLED'
    | 'INSTALLED'
    | 'ENABLED'
    | 'CONNECTED'
    | 'UPDATE_AVAILABLE'
    | 'SCOPE_REDUCED'
    | 'DELISTED'
    | 'SECURITY_RISK'
    | 'ERROR'
    | 'PARTIAL_SUCCESS';
  targets: LocalTargetSummary[];
  lastUpdatedAt?: string;
}
```

## 9.2 Skill 包落地

### 服务端保存内容

- Extension 主档；
- Version；
- package_hash；
- package_path；
- file_manifest；
- `SKILL.md` 预览；
- README 摘要；
- 风险摘要；
- 元数据快照；
- 授权范围；
- 可见选项。

### 客户端安装流程

```ts
async function installSkill(extensionId: string): Promise<InstallResult> {
  const detail = await api.getExtensionDetail(extensionId);
  assertPermission(detail.permission.canInstall);

  const ticket = await api.createDownloadTicket({
    objectType: 'EXTENSION_PACKAGE',
    extensionId,
    version: detail.currentVersion,
    purpose: 'INSTALL'
  });

  const tempFile = await downloadManager.download(ticket.downloadUrl);
  await hashVerifier.verify(tempFile, ticket.sha256);

  const plan = await centralStore.buildSkillInstallPlan({
    extensionId,
    version: detail.currentVersion,
    tempFile,
    sha256: ticket.sha256
  });

  return localExecutor.execute(plan);
}
```

### Central Store 结构

```text
central-store/skills/<extensionId>/
├── versions/<version>/
│   ├── SKILL.md
│   ├── README.md
│   └── ...
└── current.json
```

### Skill 启用

输入：

```ts
interface SkillEnableInput {
  extensionId: string;
  version: string;
  sourcePath: string;
  targets: Array<ToolTarget | ProjectTarget>;
  preferredMode: 'SYMLINK' | 'COPY';
}
```

Tool Adapter 生成计划：

```text
for each target:
  - 校验目标路径存在且可写
  - 若 symlink 可用，生成 symlink step
  - 否则生成 copy-tree step
  - 记录 managed item
```

### Skill 更新

1. 服务端发现新版本。
2. 客户端请求下载凭证。
3. 下载并 Hash 校验。
4. 写入 Central Store 新版本目录。
5. 备份 current pointer 和已启用目标元数据。
6. 切换 current。
7. 对已启用目标重新分发。
8. 失败时尽量回滚。
9. 生成 `SKILL_UPDATE` 或失败/部分成功事件。

### Skill 卸载

卸载计划：

- 删除所有托管启用目标；
- 删除 Central Store 当前副本；
- 清理 local state；
- 不删除用户手动复制的非托管文件。

如果某个目标删除失败：

- 记录部分成功；
- 不强行删除其他已成功清理状态；
- local state 标记异常，用户可重试。

## 9.3 未托管 Skill 扫描

扫描规则：

- 只识别根目录含 `SKILL.md` 的目录；
- 记录来源路径；
- 与服务端同 ID 且 Hash 一致可提示纳入管理；
- 同名不同 Hash 标记冲突；
- 纳入管理仅影响本机，不创建服务端发布记录。

`SkillScanner`：

```ts
interface SkillScanner {
  scan(paths: string[]): Promise<DiscoveredSkill[]>;
  calculateSkillHash(path: string): Promise<string>;
}
```

`DiscoveredSkill`：

```ts
interface DiscoveredSkill {
  name?: string;
  extensionId?: string;
  path: string;
  hash: string;
  hasSkillMd: boolean;
  conflict?: 'SAME_ID_DIFFERENT_HASH' | 'SAME_NAME_DIFFERENT_HASH';
}
```

## 9.4 MCP Server 定义落地

### 服务端定义

```ts
interface McpDefinition {
  serverName: string;
  version: string;
  accessType: 'REMOTE_HTTP' | 'REMOTE_SSE' | 'LOCAL_COMMAND';
  transport: 'STREAMABLE_HTTP' | 'SSE' | 'STDIO';
  endpointTemplate?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  variables: McpVariable[];
  configTemplate: unknown;
  supportedTools: string[];
  connectionTest: McpConnectionTestDefinition;
  permissions: string[];
  dataAccess: string;
  riskStatement: string;
}
```

`McpVariable`：

```ts
interface McpVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'secret' | 'enum';
  required: boolean;
  sensitive: boolean;
  default?: unknown;
  enumValues?: string[];
  description: string;
}
```

### 客户端接入流程

```text
1. 获取详情和权限。
2. 授权用户调用 /mcp-definition。
3. ToolAdapterRegistry 列出支持 MCP 写入的目标工具。
4. 用户选择工具并填写变量。
5. 敏感变量保存 SecureVariableStore，生成 SecretRef。
6. McpTemplateRenderer 渲染 redactedPreview 和 fullConfigRef。
7. ToolAdapter 生成写入计划。
8. LocalExecutor 备份原配置并写入托管配置项。
9. 可选执行连接检测。
10. 记录 MCP_CONFIG_WRITE 和 MCP_CONNECTION_TEST 事件。
```

### 敏感变量保存

服务端保存：

```json
{
  "name": "API_TOKEN",
  "type": "secret",
  "required": true,
  "sensitive": true,
  "description": "财务系统访问 Token"
}
```

客户端保存：

```json
{
  "variableName": "API_TOKEN",
  "secretRef": {
    "provider": "windows-credential-manager",
    "key": "EnterpriseAgentHub/mcp/finance/API_TOKEN"
  }
}
```

### MCP 更新

更新原则：

- 保留已有本地变量值；
- 若新增必填变量，更新计划进入 `NEEDS_INPUT`，不能自动写入；
- 若删除变量，保留旧 secret ref 一段时间或提示清理；
- 写入前备份旧配置；
- 连接检测失败时回滚。

### MCP 卸载

只删除托管配置项：

```text
managedConfigId == local recorded managedConfigId
```

不删除：

- 发布者部署的远端服务；
- 用户手写配置；
- 其他工具中的非托管 MCP 配置；
- Secure Store 中其他扩展变量。

卸载成功后可删除该扩展相关 secret refs。

## 9.5 MCP 连接检测

连接检测类型：

| 类型 | 说明 | 限制 |
|---|---|---|
| COMMAND_EXISTS | 检查本机命令存在或版本 | 不执行有副作用命令 |
| HTTP_HEALTH | 调用健康检查 endpoint | 超时、脱敏日志 |
| SSE_CONNECT | 建立 SSE 连接测试 | 短超时 |
| TOOL_ADAPTER | 由工具适配器判断配置是否可用 | 不读取用户敏感内容 |

结果：

```ts
interface ConnectionTestResult {
  status: 'SUCCESS' | 'FAILURE';
  latencyMs?: number;
  errorCode?: string;
  message?: string;
  redactedDetails?: Record<string, unknown>;
}
```

## 9.6 Plugin 定义落地

### 通用字段

```ts
interface PluginDefinition {
  pluginName: string;
  version: string;
  targetTools: string[];
  installMode: 'MANAGED_PACKAGE' | 'CONFIG_PLUGIN' | 'MANUAL_DOWNLOAD';
  compatibleVersions: string[];
  permissions: string[];
  riskStatement: string;
  changeLog: string;
}
```

### managed-package

服务端必须保存：

- 插件包；
- SHA-256；
- 包大小；
- 文件清单；
- 安装清单；
- 更新步骤；
- 卸载步骤；
- 回滚说明。

安装流程：

```text
1. 获取 Plugin Definition。
2. 检查目标工具兼容版本。
3. 请求下载凭证。
4. 下载包到 temp。
5. Hash 校验。
6. 读取安装清单。
7. Tool Adapter 将安装清单转换为 ExecutionPlan。
8. 执行计划。
9. 记录 PLUGIN_INSTALL 事件。
```

### config-plugin

不一定下载包，主要写配置。

流程：

```text
1. 获取配置清单。
2. Tool Adapter 检查目标工具配置路径。
3. 生成 json-upsert/write-file-atomic 计划。
4. 备份原配置。
5. 写入托管配置项。
6. 记录事件。
```

### manual-download

流程：

```text
1. 客户端获取 Plugin Definition，确认 installMode = MANUAL_DOWNLOAD。
2. 若用户点击下载，客户端必须先调用 POST /download-tickets，purpose = MANUAL_DOWNLOAD。
3. 服务端重新校验用户、部门、扩展状态、版本状态、授权范围、可见选项和下载来源有效期。
4. 服务端返回 Hub 代理下载 URL 或已授权的企业内网下载 URL，同时返回登记的 SHA-256 和文件大小。
5. 客户端下载到 EnterpriseAgentHub 受控下载目录。
6. 客户端校验 SHA-256 和文件大小。
7. 校验成功后记录 PLUGIN_MANUAL_CONTROLLED_DOWNLOAD 事件。
8. 用户按说明手动安装，可标记已安装或已卸载。
9. 客户端记录 PLUGIN_MANUAL_MARK_INSTALLED 或 PLUGIN_MANUAL_MARK_UNINSTALLED 事件。
```

manual-download 不自动判断真实安装状态，用户标记只作为本地状态记录和管理端参考。任何 manual-download 都不得展示自动安装按钮。

## 9.7 Plugin 安装清单示例

```yaml
installMode: managed-package
targetTool: codex
installSteps:
  - action: copy
    from: package/plugin/
    to: tool-plugin-dir
  - action: upsert-json
    target: tool-config
    jsonPointer: /plugins/code-helper
    value:
      enabled: true
rollback:
  supported: true
uninstallSteps:
  - action: remove
    target: tool-plugin-dir/code-helper
  - action: json-remove
    target: tool-config
    jsonPointer: /plugins/code-helper
```

客户端执行器只能处理白名单 action。

## 9.8 三类扩展本地状态归一

| 类型 | 安装状态来源 | 关键目标 |
|---|---|---|
| Skill | Central Store + enabled targets | 工具/项目路径 |
| MCP Server | 托管配置项 + variables refs | 工具 MCP 配置 |
| Plugin managed-package | 受控目录 + 安装清单状态 | 工具插件目录 |
| Plugin config-plugin | 托管配置项 | 工具配置 |
| Plugin manual-download | 下载记录 + 用户标记 | 本地下载文件/手动状态 |

统一本地状态计算：

```ts
function deriveLocalStatus(records: LocalRecords): LocalExtensionStatus {
  if (records.securityRisk) return 'SECURITY_RISK';
  if (records.hasError) return 'ERROR';
  if (records.partialSuccess) return 'PARTIAL_SUCCESS';
  if (records.updateAvailable) return 'UPDATE_AVAILABLE';
  if (records.enabledTargets.length > 0) return 'ENABLED';
  if (records.connectedTargets.length > 0) return 'CONNECTED';
  if (records.installed) return 'INSTALLED';
  return 'NOT_INSTALLED';
}
```

## 9.9 服务端统计口径

| 类型 | 指标 | 事件来源 | 去重键 | 是否进社区榜单 |
|---|---|---|---|---:|
| Skill | 下载量 | `download_tickets.purpose = INSTALL` | user_id + extension_id | 是，排除 AUTHORIZED_ONLY |
| Skill | 更新下载 | `download_tickets.purpose = UPDATE` | user_id + extension_id + version | 否 |
| MCP Server | 使用量 | `local_events.event_type = MCP_CONFIG_WRITE` 且成功 | user_id + extension_id | 是，排除 AUTHORIZED_ONLY |
| MCP Server | 连接检测失败数 | `MCP_CONNECTION_TEST` 失败 | event_id | 管理端辅助指标，不进使用量榜 |
| Plugin managed-package | 安装量 | `PLUGIN_INSTALL` 成功 | user_id + extension_id | 是，排除 AUTHORIZED_ONLY |
| Plugin managed-package | 受控下载量 | `download_tickets.purpose = INSTALL` 或本地下载成功 | user_id + extension_id | 管理端辅助指标 |
| Plugin config-plugin | 使用量 | `PLUGIN_CONFIG_WRITE` 成功 | user_id + extension_id | 是，排除 AUTHORIZED_ONLY |
| Plugin manual-download | 受控下载量 | `download_tickets.purpose = MANUAL_DOWNLOAD` 或 `PLUGIN_MANUAL_CONTROLLED_DOWNLOAD` | user_id + extension_id | 可展示为 manual-download 下载量，排除 AUTHORIZED_ONLY |
| Plugin manual-download | 用户标记已安装数 | `PLUGIN_MANUAL_MARK_INSTALLED` | user_id + extension_id | 单独展示，不与受控下载合并 |

硬性规则：

1. 更新下载不计入 Skill 下载量。
2. 审核包下载、文件预览下载、客户端更新下载不计入扩展社区统计。
3. MCP 连接检测成功/失败、配置复制次数、详情查看次数不得命名为“使用量”。
4. Plugin manual-download 的“受控下载用户数”和“用户标记已安装数”必须分开展示。
5. `AUTHORIZED_ONLY` 扩展不进入社区热榜、Star 榜、下载量榜、安装量榜或使用量榜；管理端仍可在权限范围内查看统计。
6. 周榜/月榜/总榜由 `metric_period_aggregates` 生成，不能从审计日志聚合。

## 9.10 类型化错误处理

### Skill

| 场景 | 错误码 |
|---|---|
| 缺少 SKILL.md | skill_manifest_missing |
| Hash 不匹配 | hash_mismatch |
| Central Store 不可写 | local_store_not_writable |
| 目标路径不可写 | target_path_not_writable |
| symlink 失败且 copy 也失败 | skill_enable_failed |

### MCP

| 场景 | 错误码 |
|---|---|
| transport 非法 | mcp_transport_invalid |
| 模板渲染失败 | mcp_config_template_invalid |
| 变量缺失 | mcp_variable_missing |
| 目标工具不支持 | mcp_tool_not_supported |
| 配置文件不可写 | mcp_config_not_writable |
| 连接检测失败 | mcp_connection_failed |

### Plugin

| 场景 | 错误码 |
|---|---|
| 安装清单非法 | plugin_manifest_invalid |
| 目标工具不支持 | plugin_tool_not_supported |
| 目标版本不兼容 | plugin_tool_version_incompatible |
| 安装失败 | plugin_install_failed |
| 卸载失败 | plugin_uninstall_failed |
| 手动下载 Hash 不匹配 | hash_mismatch |

## 9.11 扩展点

### 新工具适配器

新增目录：

```text
tool-adapters/adapters/<toolName>/
├── manifest.json
├── <ToolName>Adapter.ts
└── tests/
```

必须实现：

- detect；
- capabilities；
- 至少一种 build plan；
- 测试覆盖 dry-run、写入、回滚、路径异常。

### 新 Plugin 安装模式

不得直接扩展执行器任意 action。步骤：

1. 增加服务端枚举和校验；
2. 增加安装清单 schema；
3. 增加客户端 manifest parser；
4. 增加 ToolAdapter capability；
5. 增加本地执行 PlanStep 白名单；
6. 增加安全测试和审计事件。

### 新 MCP transport

服务端必须先扩展 `McpTransportValidator`，客户端再扩展 connection test 和 template renderer。未知 transport 默认拒绝。

## 9.12 Agent 自动开发落地约束

1. 三类扩展的接口 DTO 必须复用 `ExtensionPermission`，不得在 Skill/MCP/Plugin 各自实现不同权限字段。
2. `canConnectionTest` 不等于 `canWriteConfig`：已有托管 MCP 配置可允许本地连接检测，但新接入流程必须先通过服务端授权。
3. 所有下载前必须创建 `download_tickets`，并明确 `purpose`。
4. manual-download 使用企业内网 URL 时，客户端仍必须在服务端授权后下载，并校验登记 Hash。
5. Tool Adapter 只能生成 `ExecutionPlan`，不能自行绕过服务端权限请求下载或写入配置。
6. 本地事件命名必须与 `08_本地执行事务与ToolAdapter设计.md` 和 `12_审计_日志_通知_设备与更新.md` 保持一致。
