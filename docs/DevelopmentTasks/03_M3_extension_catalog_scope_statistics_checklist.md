# 03. M3 扩展主档、版本、授权范围、可见性、搜索与统计清单

## 1. 阶段目标

实现 Extension 统一治理主档、扩展版本、授权范围、可见选项、Star、搜索、榜单与统计基础能力。三类扩展 Skill、MCP Server、Plugin 在本阶段建立元数据和查询能力，但不实现发布审核和包上传。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M3 |
| 名称 | 扩展主档、版本、授权范围、可见性、搜索与统计 |
| 状态 | 未开始 |
| 完成率 | 0% |
| 分支 | feature/m3-extension-catalog-scope-statistics |
| 开始时间 | 待填写 |
| 完成时间 | 待填写 |
| 提交 Commit | 待填写 |
| 负责人 / Agent | 待填写 |
| 验收结论 | 待验收 |

## 3. 前置条件

- [ ] M1 已完成。
- [ ] M2 已完成。
- [ ] Auth 和 CurrentUser 可用。
- [ ] Department 管理范围计算可用。
- [ ] AuditService 可用。

## 4. 输入文档

- [ ] 阅读 `docs/RequirementDocument/02_core_concepts.md`。
- [ ] 阅读 `docs/RequirementDocument/04_extension_types.md`。
- [ ] 阅读 `docs/RequirementDocument/05_lifecycle_states.md`。
- [ ] 阅读 `docs/RequirementDocument/08_desktop_community.md`。
- [ ] 阅读 `docs/RequirementDocument/18_search_governance_metrics.md`。
- [ ] 阅读 `docs/DetailedDesign/04_服务端数据模型设计.md` extension 相关表。
- [ ] 阅读 `docs/DetailedDesign/06_权限_可见性_审核与状态机.md`。
- [ ] 阅读 `docs/DetailedDesign/19_接口契约_OpenAPI补充.md` extension/search/statistics 相关接口。

## 5. 数据库迁移任务

- [ ] 创建 `V3__extension_catalog_scope_statistics.sql`。
- [ ] 创建 `extensions` 表，`extension_id` 全局唯一。
- [ ] `extensions.type` 支持 SKILL、MCP_SERVER、PLUGIN。
- [ ] `extensions.visibility_mode` 支持 public_to_all_logged_in、authorized_only。
- [ ] `extensions.status` 支持 published、delisted、security_delisted、archived 或等价状态。
- [ ] 创建 `extension_versions` 表，版本号支持 SemVer。
- [ ] 创建 `extension_authorization_scopes` 表。
- [ ] 创建 `extension_authorized_departments` 表，支持 `include_children`。
- [ ] 创建 `mcp_definitions` 表。
- [ ] 创建 `plugin_definitions` 表。
- [ ] 创建 `stars` 表，同一用户同一扩展只能有效 Star 一次。
- [ ] 创建 `activity_events` 表。
- [ ] 创建 `extension_statistics` 或明确统计聚合位置。
- [ ] 创建 Extension 查询、榜单、统计必要索引。
- [ ] 创建 Extension ID 归档后不复用的保护机制。

## 6. 领域模型任务

- [ ] 创建 Extension、ExtensionVersion、AuthorizationScope、AuthorizedDepartment Entity。
- [ ] 创建 McpDefinition、PluginDefinition Entity。
- [ ] 创建 Star、ActivityEvent Entity。
- [ ] 创建 ExtensionType、ExtensionStatus、VersionStatus、ScopeType、VisibilityMode 枚举。
- [ ] 创建对应 Repository。
- [ ] 创建 ExtensionService、ExtensionQueryService、ScopeEvaluator、VisibilityPolicy、StatisticsService。
- [ ] 明确 Statistics 为独立模块或 Extension 子模块，不允许依赖关系悬空。

## 7. 授权范围任务

- [ ] 判断全员可用。
- [ ] 判断本部门可用。
- [ ] 判断本部门及下级部门可用。
- [ ] 判断指定部门可用。
- [ ] 判断指定部门 include_children。
- [ ] 当前主操作使用当前用户状态、当前部门状态、当前部门树和当前授权范围判断。
- [ ] 授权快照仅用于历史展示和审计。
- [ ] 部门停用后该部门用户不具备有效授权。
- [ ] 服务端不信任客户端传入的授权结果。
- [ ] 未授权主操作返回 `scope_restricted`。

## 8. 可见选项任务

- [ ] 默认展示：已发布扩展对所有登录用户可见。
- [ ] authorized_only：只有授权范围内用户、作者、具备管理权限管理员可见。
- [ ] authorized_only 不进入榜单统计。
- [ ] 未授权但可见时返回详情和不可操作原因。
- [ ] 不可见时搜索不返回。
- [ ] 不可见时直接访问详情返回 `visibility_restricted` 或简短不可见结果。
- [ ] 搜索、详情、榜单均由服务端过滤。
- [ ] 服务端不信任客户端传入的可见性判断。

## 9. API 任务

- [ ] `GET /api/extensions` 管理端列表。
- [ ] `GET /api/extensions/{extensionId}` 管理端详情。
- [ ] `GET /api/community/extensions/search` 社区搜索。
- [ ] `GET /api/community/extensions/{extensionId}` 社区详情。
- [ ] `GET /api/community/rankings` 社区榜单。
- [ ] `POST /api/extensions/{extensionId}/star`。
- [ ] `DELETE /api/extensions/{extensionId}/star`。
- [ ] `GET /api/extensions/{extensionId}/versions`。
- [ ] 列表接口支持分页、类型过滤、状态过滤、部门过滤。
- [ ] 社区搜索按类型分组或支持单类型查询。
- [ ] 榜单按 Skill、MCP Server、Plugin 分区返回。
- [ ] 榜单排除 authorized_only 扩展。

## 10. 类型化元数据任务

- [ ] Skill 元数据包含分类、标签、适用工具、适用系统、风险摘要。
- [ ] Skill 卡片 DTO 包含作者、部门、版本、Star、下载量。
- [ ] MCP Definition 支持 accessType 和 transport。
- [ ] MCP 合法组合：remote-http/streamable-http、remote-sse/sse、local-command/stdio。
- [ ] `http` 兼容输入可规范化为 `streamable-http`。
- [ ] MCP DTO 展示使用量口径：去重成功配置写入用户数。
- [ ] Plugin Definition 支持 installMode：managed-package、config-plugin、manual-download。
- [ ] Plugin DTO 展示目标工具、兼容版本、安装模式。
- [ ] Plugin 统计按安装模式区分。

## 11. 统计任务

- [ ] 实现 Star 统计。
- [ ] 实现下载量统计占位接口，M5 接入下载事件。
- [ ] 实现 MCP 使用量统计占位接口，M7 接入配置写入事件。
- [ ] 实现 Plugin 使用量统计占位接口，M7 接入安装/下载事件。
- [ ] 同一用户同一扩展下载只计一次的模型预留。
- [ ] 同一用户同一 MCP 成功配置写入只计一次的模型预留。
- [ ] 高频事件去重或限频预留。
- [ ] 统计事件与审计日志分表。

## 12. 测试任务

- [ ] Extension ID 格式校验测试。
- [ ] Extension ID 唯一性测试。
- [ ] Extension ID 归档不复用测试。
- [ ] 授权范围全员、本部门、本部门及下级、指定部门测试。
- [ ] include_children 当前部门树测试。
- [ ] 部门停用后授权失效测试。
- [ ] 可见选项默认展示测试。
- [ ] authorized_only 对未授权用户不可见测试。
- [ ] authorized_only 不进入榜单测试。
- [ ] 未授权但可见时主操作不可用标记测试。
- [ ] Star 幂等测试。
- [ ] 榜单排序测试。
- [ ] 社区搜索分页测试。
- [ ] 管理端列表管理范围过滤测试。
- [ ] MCP transport 合法组合测试。
- [ ] Plugin installMode 枚举测试。
- [ ] `mvn -f server/pom.xml test` 通过。

## 13. 阶段验收

- [ ] Extension 主档可创建或通过测试数据存在。
- [ ] 三类扩展类型边界清晰。
- [ ] 授权范围与可见选项分离实现。
- [ ] 社区搜索由服务端执行可见性过滤。
- [ ] 榜单排除 authorized_only。
- [ ] Star 可用且幂等。
- [ ] 统计模块归属明确。
- [ ] 管理端扩展列表按范围过滤。
- [ ] 所有测试通过。
- [ ] 没有越界实现发布审核和包上传。

## 14. 阶段完成记录

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
