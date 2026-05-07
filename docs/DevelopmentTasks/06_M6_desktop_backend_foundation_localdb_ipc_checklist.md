# 06. M6 桌面客户端后端基础、本地数据库与 IPC 清单

## 1. 阶段目标

初始化 Electron + React 桌面客户端后端基础，建立 Electron Main、Preload、IPC 契约、本地 SQLite、Secure Store、本地缓存、本地事件队列、API Client 和客户端基础日志能力。本阶段不实现复杂文件事务和真实 Tool Adapter 执行。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M6 |
| 名称 | 桌面客户端后端基础、本地数据库与 IPC |
| 状态 | 未开始 |
| 完成率 | 0% |
| 分支 | feature/m6-desktop-backend-foundation-localdb-ipc |
| 开始时间 | 待填写 |
| 完成时间 | 待填写 |
| 提交 Commit | 待填写 |
| 负责人 / Agent | 待填写 |
| 验收结论 | 待验收 |

## 3. 前置条件

- [ ] M1-M5 已完成或服务端 API mock 可用。
- [ ] 服务端基础 API 响应、requestID、登录、扩展、下载凭证接口可用。
- [ ] 详细设计中客户端后端边界已入库。

## 4. 输入文档

- [ ] 阅读 `docs/RequirementDocument/09_desktop_local.md`。
- [ ] 阅读 `docs/RequirementDocument/16_core_flows.md` 安装、启用、离线同步流程。
- [ ] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 客户端要求。
- [ ] 阅读 `docs/RequirementDocument/23_technical_architecture.md` 客户端本地数据边界。
- [ ] 阅读 `docs/DetailedDesign/07_客户端后端架构.md`。
- [ ] 阅读 `docs/DetailedDesign/08_本地执行事务与ToolAdapter设计.md`。
- [ ] 阅读 `docs/DetailedDesign/10_核心业务流程时序.md`。

## 5. 允许范围

- [ ] 创建 desktop/ 或 client/ 工程。
- [ ] 初始化 Electron + React + TypeScript。
- [ ] 建立 Main / Preload / Renderer 边界。
- [ ] 建立 IPC 契约和 DTO。
- [ ] 建立本地 SQLite schema。
- [ ] 建立本地事件队列。
- [ ] 建立 API Client。
- [ ] 建立本地配置和 deviceID。
- [ ] 建立 Secure Store 抽象。
- [ ] 建立客户端日志和 requestID 透传。
- [ ] 建立本地缓存和离线状态基础。

## 6. 禁止范围

- [ ] 不实现复杂文件事务。
- [ ] 不真实写入工具配置。
- [ ] 不实现 Skill symlink/copy。
- [ ] 不实现 MCP 配置写入。
- [ ] 不实现 Plugin 安装。
- [ ] 不设计视觉 UI。
- [ ] 不把服务端权限判断放到客户端作为权威。

## 7. 工程结构任务

- [ ] 创建 `desktop/` 或 `client/` 目录。
- [ ] 配置 TypeScript。
- [ ] 配置 Electron main 入口。
- [ ] 配置 preload 入口。
- [ ] 配置 renderer 基础入口。
- [ ] 配置构建脚本。
- [ ] 配置 lint/test 脚本。
- [ ] 创建 `src/main`。
- [ ] 创建 `src/preload`。
- [ ] 创建 `src/renderer`。
- [ ] 创建 `src/shared`。
- [ ] 创建 `src/main/ipc`。
- [ ] 创建 `src/main/db`。
- [ ] 创建 `src/main/api`。
- [ ] 创建 `src/main/security`。
- [ ] 创建 `src/main/events`。
- [ ] 创建 `src/main/logging`。

## 8. 本地目录任务

- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/config.json`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/device.json`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/central-store/skills`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/central-store/plugins`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/mcp/configs`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/mcp/variables`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/adapters`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/events`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/cache`。
- [ ] 初始化 `%APPDATA%/EnterpriseAgentHub/logs`。
- [ ] 首次启动生成稳定 deviceID。
- [ ] 目录创建失败时返回明确错误。

## 9. SQLite 本地数据库任务

- [ ] 选择 SQLite 访问库。
- [ ] 创建本地 DB migration 机制。
- [ ] 创建 `local_extensions` 表。
- [ ] 创建 `local_extension_versions` 表。
- [ ] 创建 `local_tools` 表。
- [ ] 创建 `local_projects` 表。
- [ ] 创建 `local_events` 表。
- [ ] 创建 `mcp_local_installations` 表。
- [ ] 创建 `plugin_local_installations` 表。
- [ ] 创建 `execution_plans` 表或执行计划日志表。
- [ ] 创建 `download_cache` 表。
- [ ] `local_tools` 不得出现重复列。
- [ ] 为 event idempotency_key 创建唯一索引。
- [ ] 为 extension_id、target、status 创建必要索引。

## 10. IPC 契约任务

- [ ] 建立 IPC 通道命名规范。
- [ ] 所有 IPC 请求使用类型化 DTO。
- [ ] 所有 IPC 响应包含 success、data/error、requestID。
- [ ] Preload 只暴露白名单 API。
- [ ] Renderer 不能直接访问 Node 文件系统能力。
- [ ] IPC 错误码与服务端错误码有映射表。
- [ ] IPC 输入做 schema 校验。
- [ ] IPC 不传递 Token 明文到日志。
- [ ] IPC 测试覆盖成功和失败。

## 11. API Client 任务

- [ ] 创建 ApiClient。
- [ ] 支持 baseURL 配置。
- [ ] 自动附加 session token。
- [ ] 自动附加或接收 requestID。
- [ ] 处理 unauthenticated 并通知 Renderer 重新登录。
- [ ] 处理 server_unavailable 并进入离线提示。
- [ ] 统一解析 ApiResponse。
- [ ] 下载接口支持流式或临时文件写入预留。
- [ ] 不在日志记录 Token、下载凭证明文、敏感变量。

## 12. Secure Store 任务

- [ ] 创建 SecureStore 接口。
- [ ] Windows 优先使用 Credential Manager、DPAPI 或等价安全能力。
- [ ] 非 Windows 开发环境提供 mock 或开发实现。
- [ ] 支持保存 session token。
- [ ] 支持保存 MCP 敏感变量。
- [ ] 支持读取、删除、更新。
- [ ] 本地数据库只保存敏感变量引用，不保存明文。
- [ ] 日志不记录敏感变量。

## 13. 本地事件队列任务

- [ ] 创建 LocalEventQueue。
- [ ] 本地事件持久化。
- [ ] 每条事件包含 idempotency_key。
- [ ] 支持 accepted、rejected、ignored 同步结果。
- [ ] 支持离线堆积。
- [ ] 支持恢复联网后批量同步。
- [ ] 同步失败可重试。
- [ ] 事件包含 deviceID、userID、extensionID、version、eventType、result、errorCode。
- [ ] 事件不包含敏感明文。

## 14. 本地缓存和离线状态任务

- [ ] 缓存社区搜索基础结果。
- [ ] 缓存扩展详情摘要。
- [ ] 缓存当前授权标记和可见性摘要，但不作为服务端权威。
- [ ] 离线时允许查看本地已安装内容。
- [ ] 离线时始终允许停用、卸载、本地清理的入口预留。
- [ ] 离线时不得执行依赖服务端授权的新安装、新下载、新接入、配置写入或更新。
- [ ] 恢复联网后刷新授权收缩、下架、安全下架状态。

## 15. 测试任务

- [ ] Electron main 启动测试。
- [ ] preload 白名单 API 测试。
- [ ] IPC 成功响应测试。
- [ ] IPC 错误响应测试。
- [ ] 本地目录初始化测试。
- [ ] deviceID 稳定性测试。
- [ ] SQLite migration 测试。
- [ ] local_events idempotency_key 唯一测试。
- [ ] ApiClient requestID 透传测试。
- [ ] ApiClient unauthenticated 处理测试。
- [ ] SecureStore mock 测试。
- [ ] 离线事件队列持久化测试。
- [ ] 日志脱敏测试。
- [ ] 客户端测试命令通过。

## 16. 阶段验收

- [ ] Electron + React + TypeScript 工程可启动。
- [ ] Main/Preload/Renderer 边界清晰。
- [ ] Renderer 不能直接执行复杂文件操作。
- [ ] 本地目录初始化完整。
- [ ] SQLite 本地数据库可迁移。
- [ ] IPC 契约类型化且有 requestID。
- [ ] ApiClient 可连接服务端或 mock 服务端。
- [ ] SecureStore 抽象可用。
- [ ] 本地事件队列可持久化和重试。
- [ ] 离线状态基础可用。
- [ ] 所有测试通过。
- [ ] 没有越界实现真实扩展执行。

## 17. 阶段完成记录

```text
完成时间：
分支：
提交 Commit：
完成项数量：
未完成项数量：
验证命令：
验证结果：
遗留问题：
是否更新总清单：
```
