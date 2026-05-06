# 20. 非功能性与部署要求

## 20.1 内网运行要求

系统运行时不得依赖互联网服务。

要求：

- 桌面客户端安装包可离线复制到用户电脑安装。
- 服务端镜像和部署包可离线复制到 Linux 服务器部署。
- Web 管理端静态资源由内网服务提供。
- 所有依赖必须在部署包或镜像中准备完毕。
- 客户端、Web 管理端、服务端均不得在运行时访问互联网更新依赖、拉取脚本、加载字体或调用外部统计服务。
- AI 系统预审只能调用企业内网 AI 服务；未配置内网 AI 服务时必须可降级为人工审核。

## 20.2 客户端要求

- 技术栈：Electron + React。
- 支持 Windows x64。
- 安装包为 exe 或企业可接受格式。
- 支持本地 Central Store。
- 支持本地工具扫描。
- 支持本地项目配置。
- 支持 Skill 安装、启用、更新、卸载。
- 支持 MCP Server 配置写入、连接检测、更新、卸载。
- 支持 Plugin 受控安装、受控下载、更新、卸载或本地状态记录。
- 支持离线启用和停用已安装 Skill。
- 支持离线停用本机已接入 MCP Server 和卸载本机托管 Plugin。
- 支持客户端设备登记、心跳和版本上报。
- 支持客户端更新检查和下载。
- 支持 Hash 校验和安装包签名校验。
- 支持本地文件与配置操作事务计划、失败反馈和尽量回滚。
- 桌面 UI 层不得直接执行复杂文件事务，必须通过本地执行层或适配器调用。

## 20.3 Web 管理端要求

- 技术栈：React。
- 通过企业内网浏览器访问。
- 仅部门管理员和系统管理员可登录。
- 支持权限路由，不向无权限用户展示入口。
- 可由服务端提供静态资源，也可由独立内网静态资源服务提供。
- 不得在运行时从互联网加载字体、图标、脚本或统计服务。

## 20.4 服务端要求

- Linux 部署。
- Docker Compose 部署。
- 服务端采用模块化单体架构，优先保证业务事务、权限校验、审核生效、审计和排障准确性。
- 技术栈：Spring Boot 3 + Java 21 + PostgreSQL + Flyway。服务端实现必须满足模块边界、事务一致性、审计和 AI 预审接入要求。
- PostgreSQL 作为业务主库。
- 服务端文件存储卷保存扩展包、MCP 定义、Plugin 包、客户端更新包和预览文件。
- 提供健康检查接口。
- 提供备份和恢复脚本。
- 提供数据库迁移机制。
- 提供离线镜像导入说明。
- 支持接入企业内网 AI 服务进行系统预审。

## 20.5 部署包结构

服务端离线部署包建议包含：

```text
enterprise-agent-hub-server/
├── docker-compose.yml
├── images/
│   ├── api.tar
│   ├── web-admin.tar
│   └── postgres-compatible-notes.md
├── config/
│   ├── app.example.env
│   ├── storage.example.yml
│   └── ai-precheck.example.yml
├── migrations/
├── scripts/
│   ├── load-images.sh
│   ├── install.sh
│   ├── backup.sh
│   ├── restore.sh
│   └── healthcheck.sh
└── README.md
```

客户端离线交付包建议包含：

```text
enterprise-agent-hub-client/
├── EnterpriseAgentHubSetup-x64.exe
├── SHA256SUMS.txt
├── signature-info.txt
└── README.md
```

## 20.6 性能要求

目标规模：几百名用户。

要求：

- 社区首页 2 秒内返回主要数据。
- 搜索结果 2 秒内返回第一页。
- 扩展详情 1 秒内返回基础信息。
- 审核列表 2 秒内返回第一页。
- 审计日志查询 3 秒内返回第一页。
- 客户端设备列表 3 秒内返回第一页。
- 单个 Skill 包大小限制 5MB。
- MCP 定义清单默认不超过 1MB。
- Plugin 包大小默认不超过系统上传限制，具体限制由系统设置控制。
- AI 系统预审不得阻塞服务端线程池；超过配置超时时必须降级。

## 20.7 可用性要求

- 服务端重启后数据不丢失。
- 客户端网络短暂中断后可恢复同步。
- 已安装 Skill 在离线时可继续使用。
- 已接入 MCP Server 在离线时保留本机配置，远端连接是否可用取决于企业内网服务。
- 已安装 Plugin 在离线时保留本机安装状态。
- 服务端异常时，桌面客户端明确提示并保留本地功能。
- 管理端写操作失败时不得展示乐观成功状态。
- 数据库迁移失败时服务端不得进入半升级状态。
- 包文件存储失败时不得创建已发布版本。
- AI 预审不可用时不得影响人工审核主流程，除非系统管理员明确配置为阻断。

## 20.8 安全要求

- 密码不得明文存储，必须使用 bcrypt、Argon2 或企业认可的强哈希算法。
- 登录失败必须限频或锁定，避免暴力破解。
- 会话必须有有效期，角色、部门、状态或密码变化后必须失效。
- Token 不得输出到日志。
- API Key 不得明文展示在设置摘要中。
- 下载凭证必须短期有效。
- 下载包必须校验 Hash。
- 客户端更新包必须校验 Hash 和签名。
- 管理端写操作必须鉴权。
- 服务端不得信任客户端提交的角色、权限、授权范围或可见选项声明。
- 所有关键操作必须写审计日志。
- 上传包必须校验路径穿越、绝对路径、解压逃逸和压缩炸弹风险。
- 预览文件不得执行脚本或打开未知二进制。
- MCP 敏感变量不得保存到服务端；客户端必须使用 Windows 安全能力保存。
- MCP local-command 必须展示 command、args、工作目录和环境变量摘要；高风险执行器和下载后执行语义必须进入审核风险提示。
- Plugin 安装必须通过安装清单和适配器执行，不允许 UI 直接写入任意路径。
- AI 系统预审输入必须脱敏，不得发送密钥、Token、密码或下载凭证明文。

## 20.9 日志要求

服务端日志分为：

1. 运行日志。
2. 审计日志。
3. 本地事件同步日志。
4. 客户端设备事件日志。
5. 普通操作统计日志。

### 运行日志

用于排查服务异常，输出到容器日志并支持日志轮转。

必须包含：

- requestID。
- 时间。
- 接口。
- 状态码。
- 耗时。
- 错误码。

### 审计日志

用于追踪关键业务动作，写入数据库。

要求：

- 可按 requestID 查询。
- 可导出 CSV。
- 可按管理员管理范围过滤。
- 不记录敏感明文。

### 本地事件同步日志

记录客户端安装、启用、停用、卸载、MCP 配置写入、Plugin 安装等事件同步结果。

### 客户端设备事件日志

记录设备登记、心跳、版本变化和更新事件。

### 普通操作统计日志

记录搜索、查看、Star、榜单点击等低风险事件，用于统计和排序，不得替代审计日志。

## 20.10 备份要求

必须支持备份：

- PostgreSQL 数据。
- 扩展包文件。
- MCP 定义清单。
- Plugin 包和安装清单。
- 客户端更新包文件。
- 配置文件。

备份脚本必须可在内网服务器执行。

建议：

- 支持手动备份和定时备份。
- 备份文件命名包含日期、版本和环境。
- 备份结束输出校验摘要。
- 备份失败返回非零退出码。
- 默认保留最近 7 次备份或按企业策略配置。

## 20.11 恢复要求

必须支持从备份恢复：

- 用户和部门。
- 扩展和版本。
- MCP 定义和接入记录。
- Plugin 包、安装清单和安装记录。
- 审核记录。
- 审计日志。
- 扩展维护人或归属部门转移。
- 客户端设备和更新记录。
- 包文件。

恢复后服务端健康检查必须通过。

恢复脚本要求：

- 恢复前提示会覆盖当前数据。
- 恢复前检查备份完整性。
- 恢复失败时输出明确失败位置。
- 恢复完成后执行数据库迁移状态检查和包文件存在性检查。

## 20.12 数据库迁移要求

本项目按全新系统构建，不需要旧测试版本迁移兼容方案。

要求：

- 每次 schema 变更必须有迁移文件。
- 迁移必须记录执行历史。
- 迁移失败必须可定位。
- 生产部署不得重复执行已成功迁移。
- 迁移前必须备份数据库。
- 破坏性迁移必须在发布说明中明确。

## 20.13 错误码要求

服务端错误必须使用稳定错误码。

常见错误码：

- unauthenticated。
- permission_denied。
- validation_failed。
- resource_not_found。
- extension_not_found。
- extension_id_exists。
- package_too_large。
- package_file_count_exceeded。
- package_path_traversal。
- package_uncompressed_size_exceeded。
- package_unsafe_file_detected。
- hash_mismatch。
- signature_invalid。
- scope_restricted。
- visibility_restricted。
- extension_delisted。
- extension_security_delisted。
- extension_archived。
- review_already_processed。
- mcp_config_template_invalid。
- mcp_transport_invalid。
- mcp_endpoint_invalid。
- mcp_tool_not_supported。
- mcp_connection_failed。
- plugin_manifest_invalid。
- plugin_tool_not_supported。
- plugin_install_failed。
- ai_precheck_unavailable。
- device_not_found。
- server_unavailable。
- client_update_required。
- account_locked。
- department_disabled。

## 20.14 测试要求

必须覆盖：

- 登录、会话、密码策略和登录失败锁定。
- 角色权限。
- 部门范围、部门停用和部门删除。
- 下级部门管理员管理。
- 发布申请。
- 系统规则校验和 AI 系统预审。
- 审核。
- 授权扩大和收缩。
- 可见选项展示扩大和展示收缩。
- 下架、安全下架、重新上架、归档和安全下架存量策略。
- Skill 安装和启用。
- MCP Server 配置写入、连接检测、更新和卸载。
- Plugin 受控安装、手动下载、更新和卸载。
- 本地事务与回滚。
- 包安全校验。
- 审计日志。
- 客户端设备登记和版本分布。
- 客户端更新。
- 离线同步。
- 备份和恢复。

## 20.15 验收标准

- Docker 部署后健康检查通过。
- 桌面客户端可连接内网服务。
- 管理端可登录。
- Electron + React 桌面客户端可离线安装运行。
- React Web 管理端可从内网访问。
- PostgreSQL 数据持久化正常。
- 审计日志可查询。
- 客户端设备可登记并上报版本。
- 备份脚本可执行。
- 恢复脚本可执行。
- 离线镜像导入脚本可执行。
- 客户端更新包可通过 Hash 和签名校验。
- AI 系统预审可配置为内网服务，且不可用时可降级人工审核。
- 关键功能在无互联网环境下可运行。
