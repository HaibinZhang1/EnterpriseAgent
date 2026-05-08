# 03. M3 扩展主档、版本、授权范围、可见性、搜索与统计清单

## 1. 阶段目标

实现 Extension 统一治理主档、扩展版本、授权范围、可见选项、Star、搜索、榜单与统计基础能力。三类扩展 Skill、MCP Server、Plugin 在本阶段建立元数据和查询能力，但不实现发布审核和包上传。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M3 |
| 名称 | 扩展主档、版本、授权范围、可见性、搜索与统计 |
| 状态 | 已完成 |
| 完成率 | 100% |
| 分支 | main（当前工作树） |
| 开始时间 | 2026-05-08 00:31:12 CST |
| 完成时间 | 2026-05-08 10:12:24 CST |
| 提交 Commit | 未提交（当前工作树） |
| 负责人 / Agent | Codex Ralph |
| 验收结论 | 通过 |

## 3. 前置条件

- [x] M1 已完成。
- [x] M2 已完成。
- [x] Auth 和 CurrentUser 可用。
- [x] Department 管理范围计算可用。
- [x] AuditService 可用。

## 4. 输入文档

- [x] 阅读 `docs/RequirementDocument/02_core_concepts.md`。
- [x] 阅读 `docs/RequirementDocument/04_extension_types.md`。
- [x] 阅读 `docs/RequirementDocument/05_lifecycle_states.md`。
- [x] 阅读 `docs/RequirementDocument/08_desktop_community.md`。
- [x] 阅读 `docs/RequirementDocument/18_search_governance_metrics.md`。
- [x] 阅读 `docs/DetailedDesign/04_服务端数据模型设计.md` extension 相关表。
- [x] 阅读 `docs/DetailedDesign/06_权限_可见性_审核与状态机.md`。
- [x] 阅读 `docs/DetailedDesign/19_接口契约_OpenAPI补充.md` extension/search/statistics 相关接口。

## 5. 数据库迁移任务

- [x] 创建 `V4__extension_catalog_scope_statistics.sql`（因现有 `V3__idempotency_records.sql` 已占用版本号）。
- [x] 创建 `extensions` 表，`extension_id` 全局唯一。
- [x] `extensions.type` 支持 SKILL、MCP_SERVER、PLUGIN。
- [x] `extensions.visibility_mode` 支持 public_to_all_logged_in、authorized_only。
- [x] `extensions.status` 支持 published、delisted、security_delisted、archived 或等价状态。
- [x] 创建 `extension_versions` 表，版本号支持 SemVer。
- [x] 创建 `extension_authorization_scopes` 表。
- [x] 创建 `extension_authorized_departments` 表，支持 `include_children`。
- [x] 创建 `mcp_definitions` 表。
- [x] 创建 `plugin_definitions` 表。
- [x] 创建 `stars` 表，同一用户同一扩展只能有效 Star 一次。
- [x] 创建 `activity_events` 表。
- [x] 创建 `extension_statistics` 或明确统计聚合位置。
- [x] 创建 Extension 查询、榜单、统计必要索引。
- [x] 创建 Extension ID 归档后不复用的保护机制。

## 6. 领域模型任务

- [x] 创建 Extension、ExtensionVersion、AuthorizationScope、AuthorizedDepartment 持久化模型或等价 JDBC 映射。
- [x] 创建 McpDefinition、PluginDefinition 持久化模型或等价 JDBC 映射。
- [x] 创建 Star、ActivityEvent 持久化模型或等价 JDBC 映射。
- [x] 创建 ExtensionType、ExtensionStatus、VersionStatus、ScopeType、VisibilityMode 枚举。
- [x] 创建对应 Repository 或等价服务层持久化访问。
- [x] 创建 ExtensionService、ExtensionQueryService、ScopeEvaluator、VisibilityPolicy、StatisticsService。
- [x] 明确 Statistics 为独立模块或 Extension 子模块，不允许依赖关系悬空。

## 7. 授权范围任务

- [x] 判断全员可用。
- [x] 判断本部门可用。
- [x] 判断本部门及下级部门可用。
- [x] 判断指定部门可用。
- [x] 判断指定部门 include_children。
- [x] 当前主操作使用当前用户状态、当前部门状态、当前部门树和当前授权范围判断。
- [x] 授权快照仅用于历史展示和审计。
- [x] 部门停用后该部门用户不具备有效授权。
- [x] 服务端不信任客户端传入的授权结果。
- [x] 未授权主操作返回 `scope_restricted`。

## 8. 可见选项任务

- [x] 默认展示：已发布扩展对所有登录用户可见。
- [x] authorized_only：只有授权范围内用户、作者、具备管理权限管理员可见。
- [x] authorized_only 不进入榜单统计。
- [x] 未授权但可见时返回详情和不可操作原因。
- [x] 不可见时搜索不返回。
- [x] 不可见时直接访问详情返回 `visibility_restricted` 或简短不可见结果。
- [x] 搜索、详情、榜单均由服务端过滤。
- [x] 服务端不信任客户端传入的可见性判断。

## 9. API 任务

- [x] `GET /api/admin/extensions` 管理端列表（按详细设计管理端路由）。
- [x] `GET /api/admin/extensions/{extensionId}` 管理端详情（按详细设计管理端路由）。
- [x] `GET /api/extensions/search` 社区搜索，并提供 `GET /api/community/extensions/search` 薄别名。
- [x] `GET /api/extensions/{extensionId}` 社区详情，并提供 `GET /api/community/extensions/{extensionId}` 薄别名。
- [x] `GET /api/extensions/community/home` 社区榜单/首页，并提供 `GET /api/community/rankings` 薄别名。
- [x] `POST /api/extensions/{extensionId}/star`。
- [x] `DELETE /api/extensions/{extensionId}/star`。
- [x] `GET /api/extensions/{extensionId}/versions`。
- [x] 列表接口支持分页、类型过滤、状态过滤、部门过滤。
- [x] 社区搜索按类型分组或支持单类型查询。
- [x] 榜单按 Skill、MCP Server、Plugin 分区返回。
- [x] 榜单排除 authorized_only 扩展。

## 10. 类型化元数据任务

- [x] Skill 元数据包含分类、标签、适用工具、适用系统、风险摘要。
- [x] Skill 卡片 DTO 包含作者、部门、版本、Star、下载量。
- [x] MCP Definition 支持 accessType 和 transport。
- [x] MCP 合法组合：remote-http/streamable-http、remote-sse/sse、local-command/stdio。
- [x] `http` 兼容输入可规范化为 `streamable-http`。
- [x] MCP DTO 展示使用量口径：去重成功配置写入用户数。
- [x] Plugin Definition 支持 installMode：managed-package、config-plugin、manual-download。
- [x] Plugin DTO 展示目标工具、兼容版本、安装模式。
- [x] Plugin 统计按安装模式区分。

## 11. 统计任务

- [x] 实现 Star 统计。
- [x] 实现下载量统计占位模型，M5 接入下载事件。
- [x] 实现 MCP 使用量统计占位模型，M7 接入配置写入事件。
- [x] 实现 Plugin 使用量统计占位模型，M7 接入安装/下载事件。
- [x] 同一用户同一扩展下载只计一次的模型预留。
- [x] 同一用户同一 MCP 成功配置写入只计一次的模型预留。
- [x] 高频事件去重或限频预留。
- [x] 统计事件与审计日志分表。

## 12. 测试任务

- [x] Extension ID 格式校验测试。
- [x] Extension ID 唯一性测试。
- [x] Extension ID 归档不复用测试。
- [x] 授权范围全员、本部门、本部门及下级、指定部门测试。
- [x] include_children 当前部门树测试。
- [x] 部门停用后授权失效测试。
- [x] 可见选项默认展示测试。
- [x] authorized_only 对未授权用户不可见测试。
- [x] authorized_only 不进入榜单测试。
- [x] 未授权但可见时主操作不可用标记测试。
- [x] Star 幂等测试。
- [x] 榜单排序测试。
- [x] 社区搜索分页测试。
- [x] 管理端列表管理范围过滤测试。
- [x] MCP transport 合法组合测试。
- [x] Plugin installMode 枚举测试。
- [x] `mvn -f server/pom.xml test` 通过。

## 13. 阶段验收

- [x] Extension 主档可创建或通过测试数据存在。
- [x] 三类扩展类型边界清晰。
- [x] 授权范围与可见选项分离实现。
- [x] 社区搜索由服务端执行可见性过滤。
- [x] 榜单排除 authorized_only。
- [x] Star 可用且幂等。
- [x] 统计模块归属明确。
- [x] 管理端扩展列表按范围过滤。
- [x] 所有测试通过。
- [x] 没有越界实现发布审核和包上传。

## 14. 阶段完成记录

```text
完成时间：2026-05-08 10:12:24 CST
分支：main（当前工作树）
提交 Commit：未提交（当前工作树）
完成项数量：109
未完成项数量：0
验证命令：Docker Maven `mvn -f server/pom.xml -Dtest=ExtensionCatalogApiTests,SubmissionReviewNotificationApiTests test`；Docker Maven `mvn -f server/pom.xml test`；`git diff --check`；JSON manifest 校验
验证结果：M3/M4 目标测试通过（9 tests, 0 failures, 0 errors）；全量测试通过（41 tests, 0 failures, 0 errors）；静态校验通过
遗留问题：无 M3 阻塞；包下载/真实使用量事件仍按阶段边界留给 M5/M7
是否更新总清单：是
```
