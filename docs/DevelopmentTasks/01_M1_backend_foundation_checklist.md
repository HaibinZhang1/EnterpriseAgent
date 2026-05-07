# 01. M1 服务端基础工程清单

## 1. 阶段目标

完成一个可运行、可测试、可通过 Docker Compose 启动的 Spring Boot 3 服务端基础工程。本阶段只搭建基础框架，不实现登录、用户、扩展、审核、包上传等业务功能。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M1 |
| 名称 | 服务端基础工程 |
| 状态 | 已完成 |
| 完成率 | 100% |
| 分支 | feature/m1-backend-foundation |
| 开始时间 | 2026-05-07 20:50:33 CST |
| 完成时间 | 2026-05-07 20:50:33 CST |
| 提交 Commit | 本次提交（以 git log 为准） |
| 负责人 / Agent | Codex / OMX deep-interview handoff |
| 验收结论 | 通过；仅完成 M1 服务端基础工程，未实现 M2-M8 业务功能 |

## 3. 输入文档

- [x] 阅读 `docs/RequirementDocument/index.md`。
- [x] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md`。
- [x] 阅读 `docs/RequirementDocument/23_technical_architecture.md`。
- [x] 阅读 `docs/DetailedDesign/02_总体架构与边界.md`。
- [x] 阅读 `docs/DetailedDesign/03_服务端模块划分与依赖.md`。
- [x] 阅读 `docs/DetailedDesign/04_服务端数据模型设计.md`。
- [x] 阅读 `docs/DetailedDesign/05_服务端接口契约.md`。
- [x] 阅读 `docs/DetailedDesign/14_异常处理_错误码_幂等.md`。
- [x] 阅读 `docs/DetailedDesign/19_接口契约_OpenAPI补充.md`。

## 4. 允许范围

- [x] 创建 `server/` Spring Boot 3 + Java 21 工程。
- [x] 创建 PostgreSQL + Flyway 基础配置。
- [x] 创建 Dockerfile、docker-compose.yml、健康检查脚本。
- [x] 实现统一响应结构。
- [x] 实现 requestID 过滤器。
- [x] 实现统一异常处理和基础错误码。
- [x] 创建 `audit_logs`、`settings`、`settings_history` 基础表。
- [x] 实现基础 AuditService。
- [x] 实现 `/api/health`。
- [x] 编写基础测试和 README。

## 5. 禁止范围

- [x] 不实现登录。
- [x] 不实现用户管理。
- [x] 不实现部门管理。
- [x] 不实现扩展发布。
- [x] 不实现审核。
- [x] 不实现包上传。
- [x] 不实现客户端 Electron。
- [x] 不实现 Web 管理端前端。
- [x] 不引入 Redis、消息队列、Elasticsearch、微服务。

## 6. 工程结构任务

- [x] 创建 `server/` 目录。
- [x] 创建 Maven `pom.xml`。
- [x] 固定 Java 版本为 21。
- [x] 创建主类 `EnterpriseAgentHubApplication`。
- [x] 设置基础包名 `com.enterpriseagent.hub`。
- [x] 创建 `common/api`、`common/error`、`common/request`、`common/audit`、`common/config`。
- [x] 创建 `controller`、`application`、`domain`、`infrastructure` 分层目录。
- [x] 创建 `src/main/resources/application.yml`。
- [x] 创建 `src/main/resources/application-dev.yml`。
- [x] 创建 `src/main/resources/db/migration/`。
- [x] 创建 `src/test/java` 测试目录。
- [x] 配置构建产物名 `enterprise-agent-hub-server.jar`。

## 7. Maven 依赖任务

- [x] 添加 `spring-boot-starter-web`。
- [x] 添加 `spring-boot-starter-validation`。
- [x] 添加 `spring-boot-starter-actuator`。
- [x] 添加 `spring-boot-starter-data-jpa`。
- [x] 添加 `flyway-core`。
- [x] 添加 PostgreSQL JDBC driver。
- [x] 添加 `spring-boot-starter-test`。
- [x] 配置 Maven wrapper 或记录本地 Maven 要求。
- [x] `mvn -f server/pom.xml test` 可执行。
- [x] `mvn -f server/pom.xml -DskipTests package` 可生成 JAR。

## 8. 配置任务

- [x] 配置应用名 `enterprise-agent-hub-server`。
- [x] 配置服务端口，默认 8080。
- [x] 通过环境变量读取数据库 host、port、db、username、password。
- [x] 配置 Flyway migration path。
- [x] 配置 JPA 不自动建表。
- [x] 配置 Actuator 仅暴露 health/info。
- [x] 配置 requestID header 名称，默认 `X-Request-ID`。
- [x] 配置日志 pattern，包含 requestId。
- [x] 创建 `.env.example` 或 `config/app.example.env`。
- [x] 检查配置文件不包含真实密码、Token、API Key。

## 9. Docker 与 Compose 任务

- [x] 创建 `server/Dockerfile`。
- [x] Dockerfile 使用 Java 21 runtime。
- [x] Dockerfile 不写入业务数据或上传文件。
- [x] 根目录创建 `docker-compose.yml`。
- [x] Compose 包含 `api` 服务。
- [x] Compose 包含 `postgres` 服务。
- [x] PostgreSQL 使用 named volume。
- [x] API 通过环境变量连接 PostgreSQL。
- [x] API 暴露 8080。
- [x] 配置 PostgreSQL healthcheck。
- [x] API 依赖 PostgreSQL 健康状态。
- [x] 创建 `.dockerignore`。
- [x] 创建 `scripts/healthcheck.sh`。
- [x] 验证 `docker compose up --build` 可启动。

## 10. Flyway 迁移任务

- [x] 创建 `V1__foundation.sql`。
- [x] 创建 `audit_logs` 表。
- [x] 创建 `settings` 表。
- [x] `settings` 表包含 `version int not null default 1`。
- [x] 创建 `settings_history` 表。
- [x] 为 `audit_logs.request_id` 创建索引。
- [x] 为 `audit_logs.created_at` 创建索引。
- [x] 为 `audit_logs.object_type, audit_logs.object_id` 创建组合索引。
- [x] 为 `settings.key` 创建唯一约束。
- [x] 时间字段统一使用 `timestamptz` 或项目统一时间类型。
- [x] 本阶段不创建 `users`、`extensions`、`submissions` 等业务表。

## 11. 统一响应、requestID、异常、审计、健康检查

- [x] 创建 `ApiResponse<T>` 和 `ApiError`。
- [x] 成功响应包含 `requestID`、`success=true`、`data`。
- [x] 失败响应包含 `requestID`、`success=false`、`error.code`、`error.message`。
- [x] 创建 `RequestIdFilter`，读取或生成 `X-Request-ID`。
- [x] 将 requestID 写入 MDC、响应头和响应体。
- [x] 创建 `ErrorCode`、`BusinessException`、`GlobalExceptionHandler`。
- [x] validation 异常返回 `validation_failed`。
- [x] 未预期异常返回 `internal_error`，不暴露堆栈。
- [x] 创建 `AuditLog` Entity、Repository、AuditService。
- [x] AuditService 支持 requestID、actor、object、action、result、reason、before/after summary。
- [x] 审计写入前执行敏感字段脱敏。
- [x] 创建 `HealthController`，提供 `GET /api/health`。
- [x] 健康检查返回服务状态、应用名称、版本、profile、时间、数据库状态。

## 12. 测试任务

- [x] ApplicationContext 可以启动。
- [x] RequestIdFilter 测试通过。
- [x] GlobalExceptionHandler 测试通过。
- [x] HealthController 测试通过。
- [x] AuditService 写入测试通过。
- [x] Flyway migration 执行成功。
- [x] `mvn -f server/pom.xml test` 通过。
- [x] `mvn -f server/pom.xml -DskipTests package` 通过。
- [x] `docker compose up --build` 后服务启动成功。
- [x] `curl http://localhost:8080/api/health` 返回成功。

## 13. 文档任务

- [x] 创建 `server/README.md`。
- [x] README 说明 Java、Maven、PostgreSQL、环境变量、测试、Docker 构建、健康检查。
- [x] README 明确本阶段未实现业务功能。

## 14. 阶段验收

- [x] `server/` Spring Boot 3 工程存在。
- [x] Java 版本固定为 21。
- [x] PostgreSQL 与 Flyway 配置完成。
- [x] `audit_logs`、`settings`、`settings_history` 通过 Flyway 创建。
- [x] `settings.version` 字段存在。
- [x] 所有 API 响应包含 requestID。
- [x] 错误响应包含稳定 errorCode。
- [x] 日志包含 requestID。
- [x] `/api/health` 可访问。
- [x] Docker Compose 可启动 API 和 PostgreSQL。
- [x] 测试全部通过。
- [x] README 足够让下一位开发者本地启动。
- [x] 没有越界实现业务模块。

## 15. 阶段完成记录

```text
完成时间：2026-05-07 20:50:33 CST
分支：feature/m1-backend-foundation
提交 Commit：本次提交（以 git log 为准）
完成项数量：124
未完成项数量：0
验证命令：见下方“16. M1 证据记录”
验证结果：全部通过
遗留问题：无 M1 阻塞；本机 Docker Hub 访问曾出现 EOF，Dockerfile/Compose 已改用 public.ecr.aws 镜像源完成验证。
是否更新总清单：是，已更新 00_MASTER_STAGE_CHECKLIST.md
```

## 16. M1 证据记录

### 16.1 变更文件

- `server/pom.xml`
- `server/Dockerfile`
- `server/README.md`
- `server/src/main/java/com/enterpriseagent/hub/**`
- `server/src/main/resources/application*.yml`
- `server/src/main/resources/db/migration/V1__foundation.sql`
- `server/src/test/java/com/enterpriseagent/hub/**`
- `docker-compose.yml`
- `.dockerignore`
- `.env.example`
- `.gitignore`
- `scripts/healthcheck.sh`
- `docs/DevelopmentTasks/00_MASTER_STAGE_CHECKLIST.md`
- `docs/DevelopmentTasks/01_M1_backend_foundation_checklist.md`

### 16.2 验证命令

- `mvn -f server/pom.xml test`
- `mvn -f server/pom.xml -DskipTests package`
- `docker compose up -d --build`
- `curl -fsS http://localhost:8080/api/health`
- `curl -fsS http://localhost:8080/actuator/health`
- `docker inspect --format {{.State.Health.Status}} enterprise-agent-hub-api`
- `git diff --check`
- `python3 -m json.tool docs/DetailedDesign/MANIFEST.json >/dev/null`
- `python3 -m json.tool docs/DevelopmentTasks/MANIFEST.json >/dev/null`
- M1 边界扫描：`grep -RInE 'create table (users|departments|extensions|submissions|extension_|review|package_|sessions)|class .*Login|/login|Electron|Redis|Elasticsearch|Kafka|Rabbit' server/src docker-compose.yml server/pom.xml` 期望无命中

### 16.3 验证结果

- Maven test：9 tests, 0 failures, 0 errors, BUILD SUCCESS。
- Maven package：BUILD SUCCESS，生成 `server/target/enterprise-agent-hub-server.jar`。
- Docker Compose：`api` 与 `postgres` 均创建并启动；`postgres` healthy；`api` health 最终 healthy。
- `/api/health`：返回 `success=true`、`requestId=req_...`、`status=UP`、`database.up=true`。
- `/actuator/health`：返回 `status=UP`。
- `git diff --check`：通过。
- 两个 JSON manifest：通过。
- M1 边界扫描：无命中，未创建 M2-M8 业务表/登录/扩展/审核/包/客户端/Redis/MQ/ES。

### 16.4 遗留问题

- 无 M1 功能阻塞。
- 本机直接拉取 Docker Hub 镜像时出现 EOF；为保证 `docker compose up -d --build` 可验证，M1 Dockerfile/Compose 使用 `public.ecr.aws` 镜像源。运行时仍为 Java 21 + PostgreSQL 16。
- 本机单元/集成测试连接本地 PostgreSQL 17.9 时 Flyway 输出“建议升级/最新已测试 PostgreSQL 16”的兼容性告警；M1 Compose 验证使用 PostgreSQL 16.6，无该版本越界。
