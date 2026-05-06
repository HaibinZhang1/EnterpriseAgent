# 17. 包规范与校验

## 17.1 总体原则

不同扩展类型使用不同包规范。系统必须在发布、审核、安装和展示过程中保留类型边界。

所有包、配置和安装清单都必须经过客户端前置校验和服务端最终校验。服务端最终校验是权威结果。

服务端可在最终校验后调用企业内网 AI 服务进行系统预审。AI 预审只输出风险摘要和建议检查项，不得自动通过或自动拒绝申请。

## 17.2 Skill 包规范

### 最小结构

```text
<skill-id>/
├── SKILL.md
├── README.md
├── CHANGELOG.md
├── icon.png
├── examples/
├── resources/
├── scripts/
└── assets/
```

### 必填

- `SKILL.md`。

### 推荐

- `README.md`。
- `CHANGELOG.md`。
- 示例文件。

### SKILL.md 要求

`SKILL.md` 应包含：

- 用途。
- 适用场景。
- 输入。
- 输出。
- 限制条件。
- 依赖。
- 风险提示。

支持 YAML frontmatter。

示例：

```yaml
---
name: code-review-skill
description: 用于代码审查的 Skill
allowed-tools: Read Grep
disable-model-invocation: false
---
```

### 限制

- 包大小不超过 5MB。
- 文件数不超过 100。
- 单文件大小不得超过系统上传限制。
- 解压后总大小不得超过系统上传限制。
- 版本号必须符合 SemVer。
- 不支持预发布版本号。
- 同一 Skill 不允许多个当前版本。

## 17.3 MCP Server 定义规范

MCP Server 发布必须提供定义清单。

### 最小结构

```text
<mcp-id>.mcp.yaml
README.md
```

如果只粘贴配置清单，系统必须在服务端保存清单快照。

### 必填字段

```yaml
serverName: string
version: string
accessType: remote-http | remote-sse | local-command
transport: stdio | streamable-http | sse
command: string        # local-command 必填
args: string[]         # 可选，local-command 常用
endpoint: string       # remote-http / remote-sse 必填
env: object            # 示例值，不得包含真实密钥
variables:
  - name: string
    type: string | number | boolean | secret | enum
    required: boolean
    sensitive: boolean
    default: any
    description: string
configTemplate: object
supportedTools: string[]
connectionTest:
  type: command-exists | http-health | sse-connect | tool-adapter
  target: string
permissions: string[]
dataAccess: string
riskStatement: string
description: string
```

说明：

- `local-command` 必须使用 `stdio` transport，并提供 command。
- `remote-http` 必须使用 `streamable-http` transport，并提供 MCP endpoint。
- `remote-sse` 必须使用 `sse` transport，并提供兼容旧版 HTTP+SSE 的 endpoint，界面标记为 legacy。
- `http` 可作为兼容输入，但服务端落库必须规范化为 `streamable-http`。
- MVP 暂不对 endpoint 是否属于企业内网地址做阻断校验；仅校验 URL 格式、协议和必填字段，并预留内网域名或 CIDR allowlist 系统设置。
- env 中不得填写真实密钥。
- variables 必须声明是否敏感。
- 敏感变量不得由服务端保存用户填写值。
- permissions 必须说明服务会访问哪些资源。
- dataAccess 必须说明数据来源和敏感性。
- configTemplate 必须能渲染目标工具可写入配置。
- connectionTest 必须说明连接检测方式。
- local-command 的 connectionTest 不得执行有副作用的命令，只能进行命令存在性、版本读取、只读健康检查或 Tool Adapter 安全检测。
- local-command 的 command、args、工作目录和环境变量摘要必须进入审核预览；通用 shell、下载器、管道、重定向或下载后执行语义必须标记高风险。

### 展示要求

MCP Server 详情必须展示：

- 接入方式。
- transport。
- 连接方式或启动命令摘要。
- 配置示例。
- 变量说明。
- 权限声明。
- 数据访问说明。
- 连接检测说明。
- 风险声明。

### 本地安装接入要求

MCP Server 定义必须支持客户端完成：

- 目标工具选择。
- 配置模板渲染。
- 本机变量填写。
- 敏感变量本机安全保存。
- 配置写入前预览。
- 配置写入、更新、卸载。
- 连接检测。
- 本地事件同步。

## 17.4 Plugin 规范

Plugin 发布必须提供插件说明、插件包或安装清单。

### 必填字段

```yaml
pluginName: string
version: string
targetTools: string[]
installMode: managed-package | config-plugin | manual-download
compatibleVersions: string[]
permissions: string[]
riskStatement: string
changeLog: string
```

### 安装模式

支持：

- managed-package。
- config-plugin。
- manual-download。

### managed-package 要求

必须提供：

- 插件包。
- SHA-256。
- 包大小。
- 文件清单。
- 安装清单。
- 更新步骤。
- 卸载步骤。
- 回滚说明。

安装清单示例：

```yaml
installMode: managed-package
targetTool: codex
installSteps:
  - action: copy
    from: package/plugin/
    to: tool-plugin-dir
rollback:
  supported: true
uninstallSteps:
  - action: remove
    target: tool-plugin-dir/plugin-id
```

### config-plugin 要求

必须提供：

- 配置清单。
- 目标配置路径规则。
- 启用步骤。
- 禁用步骤。
- 卸载步骤。
- 回滚说明。

### manual-download 要求

必须提供：

- 手动安装说明。
- 手动卸载说明。
- Hub 受控下载文件或企业内部下载地址。
- 用户如何确认安装完成。

若提供内部下载链接：

- 优先使用服务端受控文件地址。
- 如必须填写企业内部下载地址，必须登记 SHA-256、文件大小、来源系统、有效期和手动安装说明。
- MVP 暂不以地址归属作为阻断校验，但审核详情必须展示来源和风险提示。
- 客户端下载后必须校验登记的 SHA-256。
- 下载行为必须受授权范围控制，并同步下载事件。

## 17.5 通用元数据

所有扩展类型都必须提供：

- Extension ID。
- 显示名称。
- 描述。
- 分类。
- 标签。
- 版本号。
- 变更说明。
- 作者。
- 所属部门。
- 授权范围。
- 可见选项。
- 风险声明。

## 17.6 SemVer 规则

版本号格式：

```text
MAJOR.MINOR.PATCH
```

规则：

- 必须递增。
- 不支持预发布版本。
- 不支持 build metadata。
- 版本更新必须填写变更说明。

## 17.7 上传校验

客户端提交前校验：

- 必填字段。
- Extension ID 格式。
- 版本号格式。
- 分类和标签。
- 授权范围。
- 可见选项。
- 包大小。
- 文件数量。
- 类型特定必填项。

服务端最终校验：

- 所有客户端校验项。
- Extension ID 全局唯一性。
- 版本递增。
- 授权范围合法性。
- 可见选项合法性。
- 包 Hash。
- 包存储成功。
- 用户是否有权提交该范围和可见选项。
- 包安全校验。
- MCP endpoint 格式、transport 组合或 command 合法性。
- MCP 配置模板可渲染性。
- Plugin 安装清单完整性。

## 17.8 包安全校验

服务端必须执行以下安全校验：

### 路径安全

- 禁止 zip 内路径穿越，例如 `../`。
- 禁止绝对路径。
- 禁止 Windows 盘符绝对路径，例如 `C:\`。
- 禁止解压后文件逃逸出目标目录。
- 禁止 zip 内软链接指向包外路径。
- 禁止文件名为空、控制字符或系统保留名称。

### 体积与数量

- 校验压缩包大小。
- 校验解压后总大小。
- 校验单文件大小。
- 校验文件数量。
- 检测压缩炸弹风险。

### 文件类型风险

以下内容不一定禁止，但必须标记为风险并在审核详情中突出展示：

- 可执行文件。
- 脚本文件。
- 二进制文件。
- 系统配置文件。
- 证书、密钥、私钥、Token 样式内容。
- 含有外部网络地址的配置。

### 敏感信息

- MCP env 示例不得包含真实密钥。
- README、配置、脚本、安装清单中疑似密钥内容必须作为警告项展示。
- 服务端不得把敏感内容写入审计日志。
- 未勾选“仅授权范围内展示”时，系统预审必须额外提示内容外显风险。

### 预览安全

- 审核预览只展示文本和图片缩略图。
- 不得在服务端或客户端执行包内脚本。
- 不得自动打开未知二进制文件。
- 不可预览文件只提供受控下载入口。

## 17.9 文件预览规则

支持预览：

- `.md`。
- `.markdown`。
- `.txt`。
- `.json`。
- `.yaml`。
- `.yml`。

不支持预览：

- 二进制文件。
- 压缩文件内部不可解析内容。
- 图片可展示缩略图。

单文件预览超过 256 KB 时截断，并显示截断提示。

## 17.10 风险提示

当前版本不要求自动脚本沙箱扫描，但必须提示以下风险：

- 包含脚本目录。
- 包含可执行文件。
- MCP Server 声明访问敏感数据。
- MCP Server 使用外部或未识别端点。
- MCP Server 使用 local-command 且依赖本机命令。
- Plugin 需要写入工具配置。
- Plugin 提供内部下载链接。
- Plugin 安装清单缺少卸载或回滚说明。
- 扩展申请全员可用。
- 扩展申请跨部门可用。
- 扩展申请所有登录用户可见。
- 包中疑似包含密钥或令牌。

## 17.11 AI 系统预审输入要求

AI 系统预审输入必须脱敏，至少包含：

- 扩展类型。
- 名称、描述、分类、标签。
- README 摘要。
- 风险声明。
- 授权范围。
- 可见选项。
- Skill 文件清单摘要。
- MCP 配置摘要、变量 schema、权限声明和数据访问说明。
- Plugin 安装模式、安装清单摘要、权限声明和目标工具。

不得输入：

- 密码。
- Token。
- API Key 明文。
- 下载凭证明文。
- 用户填写的 MCP 敏感变量值。

## 17.12 审核包要求

管理员必须能看到：

- 包大小。
- 解压后总大小。
- 文件数量。
- 文件清单。
- Hash。
- 可预览文件内容。
- 不可预览文件下载入口。
- 系统校验结果。
- AI 系统预审结果。
- 安全风险摘要。
- 授权范围和可见选项。

## 17.13 存储要求

- 服务端存储包时不得直接覆盖旧文件。
- 包文件应按 hash 或 extension/version 维度保存。
- 同一版本包 Hash 一旦登记，不得被静默替换。
- 包存储失败时不得创建已通过的发布结果。
- 删除扩展不得删除历史包，除非执行受控归档清理策略并保留审计。
- MCP 定义清单、Plugin 安装清单必须保存版本快照。

## 17.14 验收标准

- Skill 缺少 `SKILL.md` 时不得提交成功。
- MCP Server 缺少接入方式、连接方式、配置模板或变量 schema 时不得提交成功。
- Plugin 缺少目标工具、安装模式、安装清单或手动安装说明时不得提交成功。
- 版本号不合法时不得提交成功。
- 服务端必须执行最终校验。
- 包含路径穿越、绝对路径或解压逃逸风险时必须拒绝。
- 含脚本、可执行文件、疑似密钥时必须在审核详情中提示风险。
- AI 系统预审必须脱敏输入，且不能自动替代管理员审核。
