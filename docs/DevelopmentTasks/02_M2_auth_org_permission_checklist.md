# 02. M2 账号、组织、会话与权限基础清单

## 1. 阶段目标

在 M1 基础上实现账号、部门、角色、会话、密码安全、登录失败限频、权限计算和管理范围基础能力。本阶段不实现扩展、发布、审核、包上传、客户端本地执行。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M2 |
| 名称 | 账号、组织、会话与权限基础 |
| 状态 | 已完成 |
| 完成率 | 100% |
| 分支 | feature/m2-auth-org-permission |
| 开始时间 | 2026-05-07 20:53:52 CST |
| 完成时间 | 2026-05-07 22:09:06 CST |
| 提交 Commit | 未提交（当前工作树） |
| 负责人 / Agent | Codex / OMX deep-interview + solo execution |
| 验收结论 | 通过（Docker Maven + PostgreSQL 验证） |

## 3. 前置条件

- [x] M1 已完成。
- [x] `server/` 可编译。
- [x] PostgreSQL + Flyway 可启动。
- [x] `/api/health` 正常。
- [x] 统一响应、requestID、异常处理可用。

## 4. 输入文档

- [x] 阅读 `docs/RequirementDocument/03_roles_permissions.md`。
- [x] 阅读 `docs/RequirementDocument/14_admin_org_users.md`。
- [x] 阅读 `docs/RequirementDocument/16_core_flows.md` 登录流程。
- [x] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 安全要求。
- [x] 阅读 `docs/DetailedDesign/04_服务端数据模型设计.md` 中 users、sessions、departments。
- [x] 阅读 `docs/DetailedDesign/05_服务端接口契约.md` 中 auth/users/departments。
- [x] 阅读 `docs/DetailedDesign/06_权限_可见性_审核与状态机.md`。

## 5. 数据库迁移任务

- [x] 创建 `V2__auth_org_foundation.sql`。
- [x] 创建 `V3__idempotency_records.sql` 支持管理端写操作幂等记录。
- [x] 创建 `users` 表，`id` 为不可变技术主键，`phone` 唯一。
- [x] `users.password_hash` 不允许为空，`password_algo` 记录哈希算法版本。
- [x] `users.must_change_password` 支持管理员重置后强制修改。
- [x] `users.department_id` 关联部门。
- [x] `users.role` 仅支持普通用户、部门管理员、系统管理员。
- [x] `users.status` 支持 active、frozen、deleted 或等价状态。
- [x] 创建 `sessions` 表，保存 token_hash，不保存明文 token。
- [x] sessions 支持 expires_at、revoked_at。
- [x] 创建 `login_attempts` 表。
- [x] 创建 `password_reset_tokens` 表，保存 token_hash，不保存明文 token。
- [x] 创建 `departments` 表，支持 parent_id 和 status。
- [x] 创建必要索引、唯一约束和外键约束。
- [x] 添加初始系统管理员 seed 方案，不在 SQL 中写真实密码。

## 6. 领域模型与服务任务

- [x] 创建 User、Department、Session、LoginAttempt、PasswordResetToken Entity。
- [x] 创建 Role、UserStatus、DepartmentStatus 枚举。
- [x] 创建对应 Repository。
- [x] 创建 AuthService、UserService、DepartmentService、SessionService。
- [x] 创建 PasswordService 和 PasswordPolicy。
- [x] 创建 LoginAttemptService。
- [x] 创建 CurrentUser、AuthenticationFilter、PermissionService、ManagementScopeService。
- [x] 创建组织快照对象，用于后续审计和扩展历史展示。

## 7. 密码、登录与会话任务

- [x] 使用 bcrypt、Argon2 或企业认可强哈希算法。
- [x] 密码不得明文存储。
- [x] 登录返回 session token，服务端只保存 token hash。
- [x] 桌面端与管理端 session 可配置不同有效期。
- [x] 管理端 session 空闲有效期在认证活动时滑动续期。
- [x] 登出时撤销 session。
- [x] 用户冻结、删除、角色变化、部门变化、密码变更、管理员重置密码后既有 session 失效。
- [x] session 校验失败返回 `unauthenticated`。
- [x] token 明文不得进入日志或审计。
- [x] 登录失败按账号和来源限频或锁定。
- [x] 密码错误不暴露账号是否存在。
- [x] 部门停用、用户冻结、用户删除时不可登录。

## 8. 部门与管理范围任务

- [x] 实现部门创建、修改、停用、启用、删除。
- [x] 部门暂不支持移动。
- [x] 部门停用后该部门用户不可登录。
- [x] 删除部门前校验有效用户和子部门。
- [x] 实现部门树查询。
- [x] 部门管理员用户管理范围为本部门及下级部门。
- [x] 部门管理员部门写操作仅允许下级部门。
- [x] 系统管理员管理全局。
- [x] 部门管理员不得管理同级、上级、横向部门管理员或系统管理员。
- [x] 部门管理员可管理下级部门管理员。
- [x] 部门管理员不能冻结、删除或降权自己。

## 9. 用户管理任务

- [x] 系统管理员可新增普通用户、部门管理员、系统管理员。
- [x] 系统管理员可调整任意用户部门。
- [x] 系统管理员可冻结、解冻、删除任意非保护用户。
- [x] 系统管理员可重置任意用户密码。
- [x] 部门管理员可新增管理范围内普通用户。
- [x] 部门管理员可新增下级部门管理员。
- [x] 部门管理员可修改、冻结、解冻、删除管理范围内普通用户。
- [x] 部门管理员可修改、冻结、解冻、删除下级部门管理员。
- [x] 部门管理员可重置管理范围内用户密码。
- [x] 不允许冻结、删除或降权最后一个可用系统管理员。

## 10. API 任务

### Auth API

- [x] `POST /api/auth/login`。
- [x] `POST /api/auth/logout`。
- [x] `GET /api/auth/me`。
- [x] `POST /api/auth/change-password`。
- [x] `POST /api/auth/refresh` 或明确不支持 refresh。

### User API

- [x] `GET /api/admin/users` 分页并按管理员管理范围过滤。
- [x] `POST /api/admin/users`。
- [x] `GET /api/admin/users/{id}`。
- [x] `PATCH /api/admin/users/{id}`。
- [x] `POST /api/admin/users/{id}/freeze`。
- [x] `POST /api/admin/users/{id}/unfreeze`。
- [x] `POST /api/admin/users/{id}/reset-password`。
- [x] `DELETE /api/admin/users/{id}` 或软删除接口。

### Department API

- [x] `GET /api/admin/departments/tree`。
- [x] `POST /api/admin/departments`。
- [x] `GET /api/admin/departments/{id}`。
- [x] `PATCH /api/admin/departments/{id}`。
- [x] `POST /api/admin/departments/{id}/disable`。
- [x] `POST /api/admin/departments/{id}/enable`。
- [x] `DELETE /api/admin/departments/{id}`。
- [x] 管理端用户/部门写接口强制 `Idempotency-Key` 并落库幂等记录。

## 11. 审计任务

- [x] 登录成功、登录失败、登出写审计。
- [x] 新增、修改、冻结、解冻、删除用户写审计。
- [x] 重置密码、角色变更、部门变更写审计。
- [x] 新增、修改、停用、启用、删除部门写审计。
- [x] 权限拒绝写审计。
- [x] 审计不记录密码、Token、重置凭证明文。
- [x] 成功审计与业务事务一致提交，业务回滚时不留下成功审计。

## 12. 测试任务

- [x] 登录成功测试。
- [x] 登录失败测试。
- [x] 登录失败限频测试。
- [x] 冻结用户不可登录测试。
- [x] 部门停用用户不可登录测试。
- [x] token hash 存储测试。
- [x] 会话失效测试。
- [x] 最后一个系统管理员保护测试。
- [x] 登录失败锁定不会锁定最后一个可用系统管理员测试。
- [x] 管理端 session 空闲续期测试。
- [x] 部门管理员管理范围测试。
- [x] 部门管理员不得管理同级/上级/横向管理员测试。
- [x] 部门管理员可管理下级部门管理员测试。
- [x] 用户 CRUD 权限测试。
- [x] 部门 CRUD 权限测试。
- [x] 普通用户访问管理端读接口拒绝测试。
- [x] 管理端写接口幂等 Key 缺失、重放与冲突测试。
- [x] 审计写入测试。
- [x] 失败安全审计独立提交测试。
- [x] API 响应 requestID 测试。
- [x] `mvn -f server/pom.xml test` 通过。

## 13. 阶段验收

- [x] 三类角色完整实现。
- [x] 手机号唯一，技术主键不可变。
- [x] 密码不明文存储。
- [x] 登录失败具备限频或锁定。
- [x] 会话有效期和失效规则实现。
- [x] 部门树和管理范围计算实现。
- [x] 部门管理员仅能管理范围内对象。
- [x] 最后一个可用系统管理员保护实现。
- [x] Auth/User/Department API 可用。
- [x] 关键操作写审计。
- [x] 所有测试通过。
- [x] 没有越界实现扩展业务。

## 14. 阶段完成记录

```text
完成时间：2026-05-07 23:05:17 CST
分支：feature/m2-auth-org-permission
提交 Commit：未提交（当前工作树）
完成项数量：129
未完成项数量：0
验证命令：docker run --rm --network enterparseagent_default -v "$PWD":/workspace -v "$PWD/.m2-docker":/root/.m2 -w /workspace -e EAH_TEST_DB_HOST=postgres -e EAH_TEST_DB_PORT=5432 -e EAH_TEST_DB_NAME=enterprise_agent_hub -e EAH_TEST_DB_USERNAME=eah -e EAH_TEST_DB_PASSWORD=change_me public.ecr.aws/docker/library/maven:3.9.9-eclipse-temurin-21 mvn -q -f server/pom.xml test
验证结果：通过；27 个既有/新增集成测试覆盖 auth、session、用户/部门管理范围、最后系统管理员保护、管理端写幂等、Flyway V1-V3 与统一响应。
遗留问题：M2 按设计明确不支持 refresh；生产初始管理员需部署流程注入，test profile 仅 seed 测试管理员。
是否更新总清单：是
```
