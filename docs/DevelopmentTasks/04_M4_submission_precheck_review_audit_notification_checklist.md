# 04. M4 发布申请、系统预审、审核、审计与通知清单

## 1. 阶段目标

实现发布申请 submission、submission revision、规则预审、AI 预审适配器、审核流程、审核归属、退回修改、拒绝、通过、生效、通知与审计扩展。

本阶段不实现真实包上传和下载凭证，包相关字段可以引用 M5 将实现的 Package Storage 接口，或使用受控占位对象。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M4 |
| 名称 | 发布申请、系统预审、审核、审计与通知 |
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
- [x] M3 已完成。
- [x] Auth、Org、Permission 可用。
- [x] Extension、Version、Scope、Visibility 可用。
- [x] AuditService 可用。
- [x] 统一错误码可用。

## 4. 输入文档

- [x] 阅读 `docs/RequirementDocument/05_lifecycle_states.md`。
- [x] 阅读 `docs/RequirementDocument/10_desktop_publish.md`。
- [x] 阅读 `docs/RequirementDocument/12_admin_review.md`。
- [x] 阅读 `docs/RequirementDocument/16_core_flows.md` 发布、审核、退回、拒绝流程。
- [x] 阅读 `docs/RequirementDocument/17_package_specs.md` 系统预审输入要求。
- [x] 阅读 `docs/RequirementDocument/19_notifications_settings_interaction.md`。
- [x] 阅读 `docs/DetailedDesign/06_权限_可见性_审核与状态机.md`。
- [x] 阅读 `docs/DetailedDesign/10_核心业务流程时序.md`。
- [x] 阅读 `docs/DetailedDesign/11_AI预审_安全扫描_审计设计.md`。
- [x] 阅读 `docs/DetailedDesign/19_接口契约_OpenAPI补充.md`。

## 5. 数据库迁移任务

- [x] 创建 `V5__submission_precheck_review_notification.sql`（因 M3 使用 `V4__extension_catalog_scope_statistics.sql`）。
- [x] 创建 `submissions` 表。
- [x] `submissions.status` 支持 created、validating、ai_prechecking、pending_review、in_review、changes_requested、rejected、approved、withdrawn 或等价状态。
- [x] 创建 `submission_revisions` 表，revision_no 按 submission 递增。
- [x] revision 保存 payload_snapshot 和 package_snapshot 占位。
- [x] 创建 `system_prechecks` 表，关联 submission 和 revision。
- [x] system_prechecks 保存 rule_status、rule_result、ai_status、ai_result_summary、ai_model、ai_prompt_version。
- [x] 创建 `reviews` 表，保存 reviewer_id、decision、comment。
- [x] 创建 `notifications` 表。
- [x] 创建 `extension_ownership_history` 表，如 M3 未创建。
- [x] 创建必要索引：status、submitter_id、review_owner_type、created_at。
- [x] 创建唯一约束防止同一 revision 重复生效。

## 6. Submission 与 Revision 任务

- [x] 创建 Submission、SubmissionRevision 持久化模型或等价 JDBC 映射。
- [x] 创建 SubmissionService，并在其中实现 SubmissionRevision 生命周期。
- [x] 创建 SubmissionStatus 状态机。
- [x] 首次发布创建 submission 和 revision。
- [x] 新版本发布创建 submission 和 revision。
- [x] 元信息修改创建 submission 和 revision。
- [x] 授权扩大创建 submission 和 revision。
- [x] 展示扩大创建 submission 和 revision。
- [x] 重新上架按规则创建 submission 或直接上架。
- [x] 提交后先进入 validating。
- [x] 发布者可查看自己的提交记录。
- [x] 发布者可撤回未完成申请。
- [x] 已通过/已拒绝申请不可撤回。
- [x] 退回修改后重新提交生成新 revision。
- [x] 历史 revision 不被覆盖。
- [x] system_precheck 和 review 都挂载到具体 revision。
- [x] 最终通过时记录生效 revision。

## 7. 系统规则预审任务

- [x] 创建 RulePrecheckService。
- [x] 校验 Extension ID 格式和唯一性。
- [x] 校验版本号 SemVer 和递增。
- [x] 校验授权范围合法性。
- [x] 校验可见选项合法性。
- [x] 校验提交人是否有权提交目标范围。
- [x] 校验 Skill 必填元数据和 `SKILL.md` 占位引用。
- [x] 校验 MCP accessType 与 transport 合法组合。
- [x] 校验 MCP 配置模板和变量 schema。
- [x] 校验 Plugin installMode、targetTools、manifest 或 manual doc。
- [x] 校验展示扩大、授权扩大必须进入审核。
- [x] 校验授权收缩、展示收缩可直接生效并审计。
- [x] 规则预审结果写入 system_prechecks。

## 8. AI 预审适配器任务

- [x] 创建 AiPrecheckAdapter 接口。
- [x] 创建 NoopAiPrecheckAdapter 或 MockAiPrecheckAdapter。
- [x] 创建 AiPrecheckService。
- [x] AI 输入必须脱敏。
- [x] AI 输入包含扩展类型、名称、描述、分类、标签、README 摘要、授权范围、可见选项、风险声明。
- [x] AI 输入包含 MCP 配置摘要、变量 schema、权限声明、数据访问说明。
- [x] AI 输入包含 Plugin 安装模式、清单摘要、权限声明、目标工具。
- [x] AI 输入不得包含密码、Token、API Key、下载凭证明文、用户本机敏感变量值。
- [x] AI 不可用时按设置降级。
- [x] AI 预审不得自动通过或拒绝申请。
- [x] AI 预审结果进入审核详情。
- [x] AI 预审结果进入审计链路。

## 9. 审核归属与审核任务

- [x] 创建 ReviewService。
- [x] 创建审核归属逻辑（纳入 SubmissionService/ReviewService，按系统管理员/部门管理员范围判定）。
- [x] 部门范围申请由对应部门管理员处理。
- [x] 无部门管理员时向上查找上级部门管理员。
- [x] 无上级部门管理员时交由系统管理员处理。
- [x] 指定部门跨出管理范围时交由系统管理员。
- [x] 全员可用申请必须系统管理员处理。
- [x] 展示扩大影响跨部门或全员时系统管理员处理。
- [x] 禁止自审。
- [x] 审核提交决定时二次校验管理员权限和申请最新状态。
- [x] 已处理申请不能重复处理。
- [x] 并发审核后提交者收到 `review_already_processed` 或等价错误。
- [x] 审核支持通过、退回修改、拒绝。
- [x] 通过时生效 Extension、Version、Scope、Visibility 变更。
- [x] 退回修改时保留原因并通知发布者。
- [x] 拒绝时保留原因并通知发布者。

## 10. 治理变更任务

- [x] 授权扩大必须创建 submission。
- [x] 授权收缩可直接生效并写审计。
- [x] 展示扩大必须创建 submission。
- [x] 展示收缩可直接生效并写审计。
- [x] 普通下架可由作者、部门管理员、系统管理员按权限执行。
- [x] 安全下架仅系统管理员执行。
- [x] 重新上架按原下架原因判断是否需要审核。
- [x] 归档为终态，不可重新上架，不可复用 Extension ID。
- [x] 扩展维护人或归属部门转移写 ownership history 和审计。

## 11. 通知任务

- [x] 创建 Notification 持久化表与等价服务层持久化访问。
- [x] 创建 NotificationService。
- [x] 提交申请后通知审核人。
- [x] 审核通过通知发布者。
- [x] 退回修改通知发布者。
- [x] 拒绝通知发布者。
- [x] 安全下架通知存量用户的接口预留。
- [x] 客户端更新通知接口预留。
- [x] 通知列表支持分页。
- [x] 通知支持标记已读。

## 12. API 任务

- [x] `POST /api/submissions` 创建申请。
- [x] `GET /api/submissions/mine` 查询我的提交，并提供 `GET /api/submissions/my` 薄别名。
- [x] `GET /api/submissions/{id}` 查询提交详情。
- [x] `POST /api/submissions/{id}/withdraw` 撤回。
- [x] `POST /api/submissions/{id}/revisions` 退回后重新提交，并提供 `POST /api/submissions/{id}/resubmit` 薄别名。
- [x] `GET /api/reviews/tasks` 审核任务列表。
- [x] `GET /api/reviews/tasks/{submissionId}` 审核详情。
- [x] `POST /api/reviews/tasks/{submissionId}/decision` 通过，并提供 `POST /api/reviews/tasks/{submissionId}/approve` 薄别名。
- [x] `POST /api/reviews/tasks/{submissionId}/decision` 退回修改，并提供 `POST /api/reviews/tasks/{submissionId}/request-changes` 薄别名。
- [x] `POST /api/reviews/tasks/{submissionId}/decision` 拒绝，并提供 `POST /api/reviews/tasks/{submissionId}/reject` 薄别名。
- [x] `GET /api/notifications` 通知列表。
- [x] `POST /api/notifications/{id}/read` 标记已读。
- [x] 所有写操作支持 idempotency key 或明确幂等策略。

## 13. 审计任务

- [x] 提交申请写审计。
- [x] 规则预审写审计或审计摘要。
- [x] AI 预审写审计或审计摘要。
- [x] 审核通过写审计。
- [x] 退回修改写审计。
- [x] 拒绝写审计。
- [x] 撤回写审计。
- [x] 授权收缩写审计。
- [x] 展示收缩写审计。
- [x] 下架、安全下架、重新上架、归档写审计。
- [x] 审计包含 requestID、操作人快照、对象快照、before/after summary。
- [x] 审计不记录敏感明文。

## 14. 测试任务

- [x] 创建申请生成 submission 和 revision 测试。
- [x] 退回修改生成新 revision 测试。
- [x] 历史 revision 不覆盖测试。
- [x] 规则预审状态流测试。
- [x] AI 预审降级测试。
- [x] AI 输入脱敏测试。
- [x] 审核归属部门范围测试。
- [x] 跨部门申请系统管理员处理测试。
- [x] 全员申请系统管理员处理测试。
- [x] 禁止自审测试。
- [x] 重复审核/并发审核测试。
- [x] 审核通过生效测试。
- [x] 退回修改通知测试。
- [x] 拒绝通知测试。
- [x] 授权收缩直接生效测试。
- [x] 展示收缩直接生效测试。
- [x] 展示扩大进入审核测试。
- [x] 审计写入测试。
- [x] `mvn -f server/pom.xml test` 通过。

## 15. 阶段验收

- [x] Submission/revision 流程完整。
- [x] 发布申请先创建 revision，再规则预审和 AI 预审。
- [x] 退回修改保留 revision 历史。
- [x] AI 预审不自动通过或拒绝。
- [x] 审核归属规则正确。
- [x] 禁止自审。
- [x] 审核通过/退回/拒绝均写审计。
- [x] 通知基础能力可用。
- [x] 授权扩大和展示扩大进入审核。
- [x] 授权收缩和展示收缩直接生效并审计。
- [x] 所有测试通过。
- [x] 没有越界实现包上传和客户端本地执行。

## 16. 阶段完成记录

```text
完成时间：2026-05-08 10:12:24 CST
分支：main（当前工作树）
提交 Commit：未提交（当前工作树）
完成项数量：162
未完成项数量：0
验证命令：Docker Maven `mvn -f server/pom.xml -Dtest=ExtensionCatalogApiTests,SubmissionReviewNotificationApiTests test`；Docker Maven `mvn -f server/pom.xml test`；`git diff --check`；JSON manifest 校验
验证结果：M3/M4 目标测试通过（9 tests, 0 failures, 0 errors）；全量测试通过（41 tests, 0 failures, 0 errors）；静态校验通过
遗留问题：无 M4 阻塞；真实包上传/下载凭证/文件预览仍按阶段边界留给 M5，客户端本地执行留给 M6/M7
是否更新总清单：是
```
