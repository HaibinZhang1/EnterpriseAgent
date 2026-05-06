# 23. 技术架构与数据边界

## 23.1 目标

本章定义 Enterprise Agent Hub 重构后的技术边界，避免功能实现时出现过度复杂、职责混乱或客户端与服务端权威来源不一致的问题。

核心原则：

- 服务端是账号、部门、权限、扩展、版本、发布申请、审核、统计、可见选项和审计的权威来源。
- 客户端只负责本机 UI、缓存、文件执行、工具扫描、本地启用、本地配置写入和事件上报。
- Web 管理端只负责管理任务，不承载普通用户桌面功能。
- 文件包、下载凭证、审计日志、本地事件和客户端设备事件必须能通过 requestID 串联排障。
- 本项目按全新系统构建，不考虑旧测试版本迁移兼容。

## 23.2 技术栈选择

### 桌面客户端

- 技术栈：Electron + React。
- 平台：Windows x64。
- UI 层与本地执行层必须分离。
- 本地执行层负责 Central Store、Tool Adapter、Hash 校验、配置写入、事务计划、回滚、本地日志和事件队列。
- UI 组件不得直接执行复杂文件操作或写入工具配置。

### Web 管理端

- 技术栈：React。
- 通过内网访问。
- 支持权限路由和管理端组件模板。
- 可由服务端提供静态资源，也可由独立内网静态资源服务提供。

### 服务端

- 架构：模块化单体优先，不做微服务化。
- 技术栈：Spring Boot 3 + Java 21。
- 选择原则：优先保证业务事务、权限校验、审核生效、审计写入、PostgreSQL 访问和 AI 预审接入的准确性。
- 数据库：PostgreSQL。
- 数据库迁移：Flyway。
- 部署：Docker Compose。
- AI 预审：通过适配器调用企业内网 AI 服务；AI 服务不可用时按系统设置降级。

## 23.3 服务端模块边界

服务端至少包含以下模块：

| 模块 | 职责 |
|---|---|
| Auth | 登录、会话、密码策略、登录失败锁定、密码重置、会话失效 |
| User & Department | 用户、部门、角色、部门树、部门停用、管理范围计算 |
| Extension | Extension 主档、类型、状态、维护人、归属部门、可见选项、统计摘要 |
| Authorization Scope | 授权范围、授权部门快照、范围变更判断 |
| Extension Version | 版本、包 Hash、包路径、版本状态、变更说明、元数据快照 |
| MCP Definition | MCP 定义清单、配置模板、变量 schema、连接检测定义 |
| Plugin Definition | Plugin 安装模式、安装清单、包信息、手动说明 |
| Submission | 首次发布、版本更新、元信息修改、授权变更、可见选项变更、重新上架申请、submission revision |
| System Precheck | 规则校验、包校验、内容外显风险校验、AI 系统预审编排 |
| AI Precheck Adapter | 内网 AI 服务调用、输入脱敏、超时、失败降级、结果入库 |
| Review | 审核权限判定、审核记录、审核决定生效 |
| Package Storage | 包上传、包校验、包保存、文件预览、受控下载 |
| Download Ticket | 短期下载凭证签发、校验和过期处理 |
| Local Event | 安装、启用、配置写入、停用、卸载、回滚、本地异常事件同步 |
| Client Device | 设备登记、心跳、版本分布、设备事件 |
| Notification | 审核结果、需修改、下架、安全下架、客户端更新等通知 |
| Audit | 审计日志写入、查询、导出、保留策略 |
| Client Update | Windows 客户端更新版本、签名、下载和事件 |
| Settings | 分类、标签、上传限制、审计保留、AI 预审、客户端更新、安全策略 |

## 23.4 核心数据模型

建议保留以下核心表或等价数据对象：

| 表/对象 | 关键字段 |
|---|---|
| users | id、name、phone、password_hash、password_algo、password_changed_at、must_change_password、department_id、role、status、locked_until、created_at、updated_at |
| sessions | id、user_id、device_id、token_hash、expires_at、revoked_at、created_at |
| login_attempts | id、phone、user_id、ip、user_agent、result、failure_reason、created_at |
| password_reset_tokens | id、user_id、token_hash、expires_at、used_at、created_by、created_at |
| departments | id、name、parent_id、status、created_at、updated_at |
| extensions | id、extension_id、type、name、description、author_id、maintainer_id、owner_department_id、current_version_id、visibility_mode、status、created_at、updated_at |
| extension_authorization_scopes | id、extension_id、scope_type、submitted_snapshot、approved_snapshot、effective_from、created_at |
| extension_authorized_departments | id、scope_id、department_id、include_children、department_snapshot |
| extension_versions | id、extension_id、version、package_hash、package_path、metadata_snapshot、risk_summary、status、created_at |
| mcp_definitions | id、version_id、access_type、transport、command_summary、endpoint_summary、config_template、variables_schema、connection_test、permissions、data_access |
| plugin_definitions | id、version_id、install_mode、target_tools、compatible_versions、install_manifest、manual_install_doc、package_hash、package_path、external_download_url、external_download_sha256、external_download_size、external_source_system、external_expires_at |
| submissions | id、extension_id、type、submitter_id、target_version、target_scope_snapshot、target_visibility_mode、current_revision_no、status、review_owner_type、created_at、updated_at |
| submission_revisions | id、submission_id、revision_no、payload_snapshot、package_snapshot、submitted_by、created_at |
| system_prechecks | id、submission_id、revision_id、rule_status、rule_result、ai_status、ai_result_summary、ai_model、ai_prompt_version、created_at |
| reviews | id、submission_id、revision_id、reviewer_id、decision、comment、created_at |
| extension_ownership_history | id、extension_id、from_maintainer_id、to_maintainer_id、from_department_id、to_department_id、reason、changed_by、created_at |
| audit_logs | id、request_id、actor_id、actor_snapshot、actor_department_snapshot、object_type、object_id、object_name_snapshot、action、result、reason、before_summary、after_summary、ip、user_agent、client_version、device_id、created_at |
| download_tickets | id、object_type、object_id、user_id、device_id、expires_at、used_at、status |
| local_events | id、user_id、device_id、extension_id、version、event_type、idempotency_key、result、error_code、created_at |
| extension_local_states | id、user_id、device_id、extension_id、version、type、local_status、target_summary、updated_at |
| mcp_local_installations | id、user_id、device_id、extension_id、version、tool_id、managed_config_id、status、last_connection_result、updated_at |
| plugin_local_installations | id、user_id、device_id、extension_id、version、install_mode、tool_id、status、updated_at |
| stars | id、user_id、extension_id、status、created_at、updated_at |
| activity_events | id、user_id、device_id、extension_id、event_type、period_key、created_at |
| client_devices | id、device_id、user_id、department_id、hostname_hash、os_version、arch、client_version、first_seen_at、last_seen_at、status |
| client_device_events | id、device_id、user_id、event_type、result、error_code、payload_summary、created_at |
| client_versions | id、version、build_no、package_hash、signature_status、status、published_at |
| client_update_events | id、device_id、user_id、from_version、to_version、result、error_code、created_at |
| notifications | id、user_id、type、object_type、object_id、read_at、created_at |
| tool_adapters | id、adapter_id、tool_name、adapter_version、supported_platforms、supported_install_modes、capabilities、created_at、updated_at |
| settings | key、value、updated_by、updated_at |
| settings_history | id、key、before_value、after_value、updated_by、created_at |

要求：

- 授权范围必须能表达本部门、部门树、指定部门和全员。
- 授权范围必须保存提交快照和审核通过快照，用于历史展示和审计；当前安装、下载、配置写入、更新等主操作必须按当前用户状态、当前部门状态、当前部门树和当前授权范围实时判断。
- 可见选项使用 `visibility_mode` 表达，建议值为 `public_to_all_logged_in` 和 `authorized_only`。
- `authorized_only` 表示无权限用户不可见、不进入榜单统计。
- 操作人、作者、部门等历史展示需要保存快照，避免用户调部门后破坏历史记录。
- Extension ID 必须全局唯一，不允许跨类型复用。
- 部门暂不支持移动；部门停用后，该部门用户不可登录，归属该部门的活跃扩展在社区视为失效。
- Submission 必须先创建再执行系统校验和 AI 预审；system_prechecks 必须挂载到具体 submission revision。
- 扩展维护人或归属部门转移必须记录历史，不修改历史作者、历史部门和历史审核快照。
- 统计事件和审计日志分开存储，避免高频行为污染审计表。
- 客户端设备模型必须支持版本分布、最近在线、更新失败和本地事件排查。

## 23.5 API 规范

### 通用要求

- 所有 API 响应包含 requestID。
- 所有列表接口支持分页。
- 所有写操作必须鉴权并在服务端重新计算权限。
- 所有写操作失败不得返回乐观成功。
- 关键写操作支持 idempotency key，避免重复提交。
- 错误使用稳定错误码，不只返回自然语言。
- 搜索、详情、榜单必须由服务端按可见选项过滤。

### 建议 API 分组

```text
/api/auth/*
/api/users/*
/api/departments/*
/api/extensions/*
/api/authorization-scopes/*
/api/versions/*
/api/mcp-definitions/*
/api/plugin-definitions/*
/api/submissions/*
/api/prechecks/*
/api/reviews/*
/api/packages/*
/api/download-tickets/*
/api/local-events/*
/api/client-devices/*
/api/notifications/*
/api/audit-logs/*
/api/client-updates/*
/api/settings/*
```

### 权限过滤

- 社区搜索返回当前用户可见的已发布扩展，并附带当前用户操作权限标记。
- 榜单排除 `authorized_only` 的扩展。
- 管理端列表按管理员管理范围过滤。
- 审核提交决定时必须再次检查管理员是否有权处理该申请。
- 客户端不得通过隐藏字段绕过服务端授权校验或可见选项校验。

## 23.6 文件存储规范

服务端文件存储卷至少包含：

```text
/storage/
├── packages/
│   ├── skill/
│   ├── mcp/
│   └── plugin/
├── manifests/
│   ├── mcp/
│   └── plugin/
├── client-updates/
├── previews/
├── temp/
└── backups/
```

要求：

- 上传先进入 temp，校验通过后再移动到正式目录。
- 正式包文件不得静默覆盖。
- 包路径建议包含类型、Extension ID、版本和 Hash。
- 数据库记录必须保存包 Hash、包大小、文件数量和存储路径。
- MCP 定义清单和 Plugin 安装清单必须按版本保存快照。
- 下载必须通过短期下载凭证。
- 删除扩展不得直接删除历史包，除非进入受控清理流程并写审计。

## 23.7 客户端本地数据边界

客户端本地至少包含：

```text
%APPDATA%/EnterpriseAgentHub/
├── config.json
├── device.json
├── central-store/
│   ├── skills/
│   └── plugins/
├── mcp/
│   ├── configs/
│   └── variables/
├── adapters/
├── events/
├── cache/
└── logs/
```

要求：

- Central Store 保存已安装 Skill 和托管 Plugin，不保存服务端权限权威结果。
- MCP 本地目录保存托管配置摘要和变量引用，不保存服务端权限权威结果。
- 敏感变量不得明文保存，应使用 Windows Credential Manager、DPAPI 或等价 Windows 安全能力。
- 本地缓存只用于离线展示、停用、卸载和本机清理，不作为服务端授权权威；离线新增启用只能基于最近一次服务端授权标记执行，恢复联网后以服务端判定为准。
- deviceID 首次启动生成，后续保持稳定。
- 本地事件必须持久化队列，联网后同步。
- 本地事件必须包含 idempotency key。
- 本地日志不得记录 API Key、Token、下载凭证明文或 MCP 敏感变量明文。

## 23.8 Tool Adapter 接口

Tool Adapter 负责把 Skill、MCP Server、Plugin 应用到具体工具或项目。

每个适配器至少声明：

- adapterId。
- adapterVersion。
- 工具名称。
- 支持平台。
- 默认扫描路径。
- Skill 目标路径识别规则。
- MCP 配置路径识别规则。
- Plugin 目标路径识别规则。
- 支持 symlink、copy、配置写入或受控安装。
- 是否需要格式转换。
- 是否支持连接检测。
- 是否支持回滚。
- 支持的安装模式。
- 支持的目标工具版本范围。
- 是否支持 dry-run。
- 启用计划生成方法。
- 停用计划生成方法。
- 更新计划生成方法。
- 卸载计划生成方法。

适配器不得直接访问服务端权限接口。是否允许安装、接入、更新和下载由客户端通过服务端 API 获取结果后再调用适配器执行。

## 23.9 本地事件同步

本地事件包含：

- Skill 安装成功或失败。
- Skill 更新成功或失败。
- Skill 启用成功或失败。
- Skill 停用成功或失败。
- Skill 卸载成功或失败。
- MCP 配置写入成功或失败。
- MCP 连接检测成功或失败。
- MCP 更新成功或失败。
- MCP 卸载成功或失败。
- Plugin 下载、安装、更新、启用、禁用、卸载成功或失败。
- symlink 降级 copy。
- Hash 校验失败。
- 回滚成功或失败。
- 部分成功。

同步要求：

- 每条事件必须包含 idempotency key。
- 服务端按 idempotency key 去重。
- 服务端接收后返回 accepted、rejected 或 ignored。
- 权限、版本、下架、安全下架或可见选项已变化时，服务端返回最新状态提示客户端刷新本地状态。

## 23.10 AI 系统预审边界

AI 系统预审用于辅助管理员识别发布风险。

输入：

- 脱敏后的扩展元数据。
- README 摘要。
- 文件清单摘要。
- MCP 配置摘要、变量 schema、权限声明、数据访问说明。
- Plugin 安装模式、安装清单摘要、权限声明、目标工具。
- 授权范围和可见选项。

输出：

- 预审状态。
- 风险摘要。
- 疑似敏感信息摘要。
- 建议管理员重点检查项。
- 预审模型或规则版本。

限制：

- AI 预审不得自动通过或拒绝申请。
- AI 预审不得接收密码、Token、API Key、下载凭证明文或用户本机敏感变量值。
- AI 服务必须是企业内网地址。
- AI 预审失败时按系统设置降级，不得导致服务端主流程不可用。
- AI 预审结果必须进入审核详情和审计链路。

## 23.11 日志链路

一次关键操作应能串联：

```text
客户端 requestID
  -> 服务端运行日志
  -> 审计日志
  -> 本地事件
  -> 客户端设备事件
  -> 管理端审计详情
```

要求：

- 客户端调用服务端时携带或接收 requestID。
- 服务端运行日志和审计日志使用同一个 requestID。
- 本地事件同步时携带原操作 requestID 或关联 ID。
- 客户端设备事件携带 deviceID。
- 管理端审计详情可复制 requestID，并可跳转客户端设备详情。

## 23.12 验收标准

- 技术栈明确：桌面端 Electron + React，Web 管理端 React，服务端 Spring Boot 3 + Java 21，数据库 PostgreSQL，迁移工具 Flyway。
- 服务端模块边界明确且不互相替代。
- 服务端支持接入企业内网 AI 服务进行系统预审，且 AI 结果不替代管理员审核。
- 核心数据模型能支持三角色、三扩展类型、授权范围、可见选项、发布审核、MCP 接入、Plugin 安装、客户端设备和审计。
- API 具备 requestID、错误码、分页、权限校验和幂等能力。
- 文件存储不静默覆盖历史包。
- 客户端 Central Store、本地执行层和 Tool Adapter 边界明确。
- MCP 敏感变量不保存到服务端。
- 本地事件同步可去重、可排障。
- 客户端设备事件可用于版本治理和更新失败排查。
- 审计日志和运行日志可通过 requestID 关联。
