# 06. M6 桌面客户端后端基础、本地数据库与 IPC 清单

## 1. 阶段目标

初始化 Electron + React 桌面客户端后端基础，建立 Electron Main、Preload、IPC 契约、本地 SQLite、Secure Store、本地缓存、本地事件队列、API Client 和客户端基础日志能力。本阶段不实现复杂文件事务和真实 Tool Adapter 执行。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M6 |
| 名称 | 桌面客户端后端基础、本地数据库与 IPC |
| 状态 | 已完成 |
| 完成率 | 100% |
| 分支 | feature/m6-desktop-backend-foundation-localdb-ipc |
| 开始时间 | 2026-05-08 13:14:12 CST |
| 完成时间 | 2026-05-08 13:59:15 CST |
| 提交 Commit | 未提交（当前工作树） |
| 负责人 / Agent | Codex Ralph |
| 验收结论 | 通过 |

## 3. 前置条件

- [x] M1-M5 已完成或服务端 API mock 可用。
- [x] 服务端基础 API 响应、requestID、登录、扩展、下载凭证接口可用。
- [x] 详细设计中客户端后端边界已入库。

## 4. 输入文档

- [x] 阅读 `docs/RequirementDocument/09_desktop_local.md`。
- [x] 阅读 `docs/RequirementDocument/16_core_flows.md` 安装、启用、离线同步流程。
- [x] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 客户端要求。
- [x] 阅读 `docs/RequirementDocument/23_technical_architecture.md` 客户端本地数据边界。
- [x] 阅读 `docs/DetailedDesign/07_客户端后端架构.md`。
- [x] 阅读 `docs/DetailedDesign/08_本地执行事务与ToolAdapter设计.md`。
- [x] 阅读 `docs/DetailedDesign/10_核心业务流程时序.md`。

## 5. 允许范围

- [x] 创建 desktop/ 或 client/ 工程。
- [x] 初始化 Electron + React + TypeScript。
- [x] 建立 Main / Preload / Renderer 边界。
- [x] 建立 IPC 契约和 DTO。
- [x] 建立本地 SQLite schema。
- [x] 建立本地事件队列。
- [x] 建立 API Client。
- [x] 建立本地配置和 deviceID。
- [x] 建立 Secure Store 抽象。
- [x] 建立客户端日志和 requestID 透传。
- [x] 建立本地缓存和离线状态基础。

## 6. 禁止范围

- [x] 不实现复杂文件事务。
- [x] 不真实写入工具配置。
- [x] 不实现 Skill symlink/copy。
- [x] 不实现 MCP 配置写入。
- [x] 不实现 Plugin 安装。
- [x] 不设计视觉 UI。
- [x] 不把服务端权限判断放到客户端作为权威。

## 7. 工程结构任务

- [x] 创建 `desktop/` 或 `client/` 目录。
- [x] 配置 TypeScript。
- [x] 配置 Electron main 入口。
- [x] 配置 preload 入口。
- [x] 配置 renderer 基础入口。
- [x] 配置构建脚本。
- [x] 配置 lint/test 脚本。
- [x] 创建 `src/main`。
- [x] 创建 `src/preload`。
- [x] 创建 `src/renderer`。
- [x] 创建 `src/shared`。
- [x] 创建 `src/main/ipc`。
- [x] 创建 `src/main/db`。
- [x] 创建 `src/main/api`。
- [x] 创建 `src/main/security`。
- [x] 创建 `src/main/events`。
- [x] 创建 `src/main/logging`。

## 8. 本地目录任务

- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/config.json`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/device.json`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/central-store/skills`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/central-store/plugins`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/mcp/configs`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/mcp/variables`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/adapters`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/events`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/cache`。
- [x] 初始化 `%APPDATA%/EnterpriseAgentHub/logs`。
- [x] 首次启动生成稳定 deviceID。
- [x] 目录创建失败时返回明确错误。

## 9. SQLite 本地数据库任务

- [x] 选择 SQLite 访问库。
- [x] 创建本地 DB migration 机制。
- [x] 创建 `local_extensions` 表。
- [x] 创建 `local_extension_versions` 表。
- [x] 创建 `local_tools` 表。
- [x] 创建 `local_projects` 表。
- [x] 创建 `local_events` 表。
- [x] 创建 `mcp_local_installations` 表。
- [x] 创建 `plugin_local_installations` 表。
- [x] 创建 `execution_plans` 表或执行计划日志表。
- [x] 创建 `download_cache` 表。
- [x] `local_tools` 不得出现重复列。
- [x] 为 event idempotency_key 创建唯一索引。
- [x] 为 extension_id、target、status 创建必要索引。

## 10. IPC 契约任务

- [x] 建立 IPC 通道命名规范。
- [x] 所有 IPC 请求使用类型化 DTO。
- [x] 所有 IPC 响应包含 success、data/error、requestID。
- [x] Preload 只暴露白名单 API。
- [x] Renderer 不能直接访问 Node 文件系统能力。
- [x] IPC 错误码与服务端错误码有映射表。
- [x] IPC 输入做 schema 校验。
- [x] IPC 不传递 Token 明文到日志。
- [x] IPC 测试覆盖成功和失败。

## 11. API Client 任务

- [x] 创建 ApiClient。
- [x] 支持 baseURL 配置。
- [x] 自动附加 session token。
- [x] 自动附加或接收 requestID。
- [x] 处理 unauthenticated 并通知 Renderer 重新登录。
- [x] 处理 server_unavailable 并进入离线提示。
- [x] 统一解析 ApiResponse。
- [x] 下载接口支持流式或临时文件写入预留。
- [x] 不在日志记录 Token、下载凭证明文、敏感变量。

## 12. Secure Store 任务

- [x] 创建 SecureStore 接口。
- [x] Windows 优先使用 Credential Manager、DPAPI 或等价安全能力。
- [x] 非 Windows 开发环境提供 mock 或开发实现。
- [x] 支持保存 session token。
- [x] 支持保存 MCP 敏感变量。
- [x] 支持读取、删除、更新。
- [x] 本地数据库只保存敏感变量引用，不保存明文。
- [x] 日志不记录敏感变量。

## 13. 本地事件队列任务

- [x] 创建 LocalEventQueue。
- [x] 本地事件持久化。
- [x] 每条事件包含 idempotency_key。
- [x] 支持 accepted、rejected、ignored 同步结果。
- [x] 支持离线堆积。
- [x] 支持恢复联网后批量同步。
- [x] 同步失败可重试。
- [x] 事件包含 deviceID、userID、extensionID、version、eventType、result、errorCode。
- [x] 事件不包含敏感明文。

## 14. 本地缓存和离线状态任务

- [x] 缓存社区搜索基础结果。
- [x] 缓存扩展详情摘要。
- [x] 缓存当前授权标记和可见性摘要，但不作为服务端权威。
- [x] 离线时允许查看本地已安装内容。
- [x] 离线时始终允许停用、卸载、本地清理的入口预留。
- [x] 离线时不得执行依赖服务端授权的新安装、新下载、新接入、配置写入或更新。
- [x] 恢复联网后刷新授权收缩、下架、安全下架状态。

## 15. 测试任务

- [x] Electron main 启动测试。
- [x] preload 白名单 API 测试。
- [x] IPC 成功响应测试。
- [x] IPC 错误响应测试。
- [x] 本地目录初始化测试。
- [x] deviceID 稳定性测试。
- [x] SQLite migration 测试。
- [x] local_events idempotency_key 唯一测试。
- [x] ApiClient requestID 透传测试。
- [x] ApiClient unauthenticated 处理测试。
- [x] SecureStore mock 测试。
- [x] 离线事件队列持久化测试。
- [x] 日志脱敏测试。
- [x] 客户端测试命令通过。

## 16. 阶段验收

- [x] Electron + React + TypeScript 工程可启动。
- [x] Main/Preload/Renderer 边界清晰。
- [x] Renderer 不能直接执行复杂文件操作。
- [x] 本地目录初始化完整。
- [x] SQLite 本地数据库可迁移。
- [x] IPC 契约类型化且有 requestID。
- [x] ApiClient 可连接服务端或 mock 服务端。
- [x] SecureStore 抽象可用。
- [x] 本地事件队列可持久化和重试。
- [x] 离线状态基础可用。
- [x] 所有测试通过。
- [x] 没有越界实现真实扩展执行。

## 17. 阶段完成记录

```text
完成时间：2026-05-08 13:59:15 CST
分支：main（当前工作树）
提交 Commit：未提交（当前工作树）
完成项数量：全部清单项已完成
未完成项数量：0
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron；git diff --check；JSON manifest 校验
验证结果：desktop typecheck 通过；Vitest 9 files / 17 tests 通过；lint 通过；Vite/Electron main build 通过；真实 Electron runtime isolation smoke 通过；electron-smoke 1 file / 2 tests 通过；静态校验通过
遗留问题：服务端 local-events / client-devices / client-update / MCP/Plugin 详情接口仍按 M6 边界使用 mock/contract stub，后续 M7/M8 处理；无 M6 阻塞。
是否更新总清单：是
```

## 18. 后续补充记录：桌面 Renderer / IPC 联通

```text
补充时间：2026-05-25 CST
补充内容：在不改变 Main/Preload/Renderer 安全边界的前提下，桌面 Renderer 从 smoke screen 替换为真实 React 客户端；preload 白名单补齐 auth.me/changePassword、extension star/definition/install、local lifecycle/local cleanup、settings save、MCP/Plugin 动作、publish、notifications 等必要通道；Main 层继续负责 API client、本地执行器、SecureStore、本地 DB 和事件队列。
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron
验证结果：desktop typecheck 通过；Vitest 20 files / 51 tests 通过；desktop lint 通过；Vite/Electron main build 通过；Electron runtime isolation smoke 与 electron-smoke 1 file / 2 tests 通过。
未验证：未连接真实服务端跑完整桌面 E2E；未执行 Windows x64 签名安装包验证。
```
