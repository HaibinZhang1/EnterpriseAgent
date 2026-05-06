# 21. 术语表

| 术语 | 英文 | 定义 |
|---|---|---|
| Extension | Extension | 企业内部可发现、发布、审核、展示、安装或使用的统一扩展对象 |
| Skill | Skill | 以 `SKILL.md` 为入口的文件型 Agent 能力包 |
| MCP Server | MCP Server | 通过 Model Context Protocol 提供上下文、工具调用或数据访问能力的接入型扩展 |
| Plugin | Plugin | 面向指定工具或 Agent 环境的插件型扩展 |
| Extension ID | Extension ID | 扩展唯一标识，用于服务端、包、下载和本地目录映射 |
| 显示名称 | Display Name | 扩展在界面中的友好名称，允许重名 |
| 作者 | Author | 提交发布申请的用户 |
| 扩展维护人 | Extension Maintainer | 当前负责后续版本、元信息和治理申请的用户，可由管理员转移 |
| 所属部门 | Owner Department | 扩展当前治理归属部门，历史展示保留发布时部门快照 |
| 普通用户 | Normal User | 使用桌面客户端、安装或接入扩展、提交发布申请的用户 |
| 部门管理员 | Department Admin | 管理本部门及下级部门用户、下级部门管理员、审核部门范围发布申请的管理员 |
| 系统管理员 | System Admin | 管理全局用户、部门、扩展、审计、客户端设备、客户端更新和系统设置的管理员 |
| 授权范围 | Authorization Scope | 决定用户是否可发起新安装、新下载、复制配置、新增启用、配置写入或更新等主操作的范围规则 |
| 可见选项 | Visibility Option | 发布时选择是否仅授权范围内展示；勾选表示无权限用户不可见、不进入榜单统计 |
| 本部门可用 | Department Available | 作者发布时所属部门用户可发起安装、下载、接入、配置写入、新增启用和更新等主操作 |
| 本部门及下级部门可用 | Department Tree Available | 作者部门及其下级部门用户可发起安装、下载、接入、配置写入、新增启用和更新等主操作 |
| 指定部门可用 | Selected Departments Available | 指定部门用户可发起安装、下载、接入、配置写入、新增启用和更新等主操作 |
| 全员可用 | All Employees Available | 企业内所有登录用户可发起安装、下载、接入、配置写入、新增启用和更新等主操作 |
| 安装 | Install | 客户端下载扩展制品到本机受控存储位置，或按安装清单写入目标工具 |
| 接入 | Connect / Attach | 将 MCP Server 配置写入目标工具，使工具可连接对应 MCP 服务 |
| 启用 | Enable | 将已安装 Skill 或 Plugin 配置到工具或项目中生效 |
| 停用 | Disable | 从工具或项目移除已启用内容，不删除本机受控副本 |
| 卸载 | Uninstall | 删除本机受控副本、托管配置或本地安装记录；不受当前授权范围限制 |
| Central Store | Central Store | 桌面客户端本机保存已安装 Skill 的受控目录 |
| Tool Adapter | Tool Adapter | 面向具体 AI 工具的路径识别、格式转换、配置写入、安装和回滚适配能力 |
| MCP 配置模板 | MCP Config Template | 用于渲染目标工具 MCP 配置项的模板，包含变量和敏感字段定义 |
| Plugin 安装清单 | Plugin Install Manifest | 描述插件安装、更新、启用、禁用、卸载和回滚步骤的清单 |
| managed-package | Managed Package | Plugin 安装模式之一，服务端托管插件包并由客户端受控安装 |
| config-plugin | Config Plugin | Plugin 安装模式之一，通过配置清单写入目标工具配置 |
| manual-download | Manual Download | Plugin 安装模式之一，提供受控下载和手动安装说明 |
| 项目 | Project | 用户手动维护的本机项目路径，可配置项目级 Skill 启用 |
| 发布申请 | Submission | 用户提交的首次发布、版本更新、元信息修改、授权变更或可见选项变更申请 |
| 系统预审 | System Precheck | 服务端对发布申请进行规则校验和可选 AI 风险识别的过程 |
| AI 系统预审 | AI Pre-review | 接入企业内网 AI 服务对发布内容进行辅助风险识别，不替代管理员审核 |
| 审核 | Review | 管理员对发布申请作出通过、退回修改或拒绝决定的过程 |
| 退回修改 | Changes Requested | 审核不直接拒绝，要求发布者修改后重新提交 |
| 拒绝 | Reject | 本次发布申请结束，发布者可复制为新申请 |
| 普通下架 | Delist | 扩展不再社区展示，也不允许新安装、接入、复制配置、下载或更新；存量本地状态保留 |
| 安全下架 | Security Delist | 因安全风险停止新使用并提醒存量用户的治理动作 |
| 重新上架 | Relist | 已下架扩展重新恢复为已发布状态 |
| 归档 | Archive | 扩展进入终态，不可重新上架 |
| 授权扩大 | Scope Expansion | 可发起安装、下载、复制配置、配置写入、新增启用和更新等主操作的人群扩大，需要审核 |
| 授权收缩 | Scope Reduction | 可发起安装、下载、复制配置、配置写入、新增启用和更新等主操作的人群缩小，可直接生效但必须审计；不禁止停用、卸载和本地清理 |
| 展示扩大 | Visibility Expansion | 从仅授权范围内展示改为所有登录用户可展示，需要审核 |
| 展示收缩 | Visibility Reduction | 从所有登录用户可展示改为仅授权范围内展示，可直接生效但必须审计 |
| Star | Star | 用户收藏或推荐扩展的行为，影响展示和排序 |
| 下载量 | Download Count | 用户以安装或下载目的获取扩展制品的去重累计值 |
| 安装量 | Install Count | Plugin 或其他可安装扩展成功安装的去重累计值 |
| 使用量 | Usage Count | MCP Server 固定采用去重成功配置写入用户数的统计指标 |
| 审计日志 | Audit Log | 记录关键操作的持久化日志，用于排查和追踪 |
| 普通操作日志 | Activity Log | 记录搜索、查看、Star、榜单点击等低风险行为的统计日志 |
| requestID | Request ID | 一次请求在服务端、日志、审计中的链路标识 |
| 下载凭证 | Download Ticket | 服务端签发的短期扩展或更新包下载授权 |
| 客户端设备 | Client Device | 桌面客户端安装实例，用 deviceID 标识，用于版本治理和排障 |
| 客户端更新 | Client Update | Windows 桌面客户端版本发布、检查、下载和安装流程 |
| 本地事件 | Local Event | 客户端安装、接入、启用、停用、卸载、回滚等本机动作产生的同步事件 |
| 部分成功 | Partial Success | 本地多目标操作中部分目标成功、部分目标失败的状态 |
