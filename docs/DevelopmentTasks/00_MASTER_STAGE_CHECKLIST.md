# 00. EnterpriseAgent 总阶段清单：M1-M8

> 本文件用于统计整体开发进度。Agent 每完成一个阶段，必须同步更新本文件。
>
> 勾选规则：只有对应子清单中的“阶段完成定义”和“验收命令”全部通过，才允许在本总清单中勾选阶段完成。

## 1. 总体状态

| 字段 | 当前值 | 更新说明 |
|---|---|---|
| 项目 | EnterpriseAgent / Enterprise Agent Hub | 固定 |
| 当前阶段 | M8 设备更新与最终发布门禁收口 | Agent 每次开始新阶段时更新 |
| 总阶段数 | 8 | M1-M8 |
| 总体完成率 | 99% | M1-M7 已完成，M8 本地可验证发布门禁已收口到 94%；最终外部门禁保留 |
| 当前分支 | main（当前工作树） | Agent 填写 |
| 最近提交 | 未提交（当前工作树）；基线 `5ffc916` | Agent 填写 commit hash |
| 最近验证时间 | 2026-05-25 CST | Agent 填写 |
| 当前阻塞项 | M8 最终发布门禁保留：真实服务端桌面 E2E 联调、真实 Windows x64 installer/signing、Web Admin 服务端托管/离线镜像、真实离线镜像导入、Docker Compose 服务部署、air-gapped/no-internet 隔离验证 | Agent 填写 |
| 下一阶段 | M8 最终验收与外部门禁交接 | Agent 更新 |

## 2. M1-M8 阶段总览

| 阶段 | 名称 | 目标 | 状态 | 完成率 | 子清单 | 验收结论 |
|---|---|---|---|---:|---|---|
| M1 | 服务端基础工程 | Spring Boot 3 + Java 21 + PostgreSQL + Flyway + Docker Compose 基础可运行 | 已完成 | 100% | `01_M1_backend_foundation_checklist.md` | 通过 |
| M2 | 账号、组织、会话与权限基础 | Auth、User、Department、Session、角色、权限边界 | 已完成 | 100% | `02_M2_auth_org_permission_checklist.md` | 通过 |
| M3 | 扩展主档、版本、授权范围、可见性、搜索与统计 | Extension、Version、Scope、Visibility、Search、Star、Statistics | 已完成 | 100% | `03_M3_extension_catalog_scope_statistics_checklist.md` | 通过 |
| M4 | 发布申请、系统预审、审核、审计与通知 | Submission、Revision、Rule Precheck、AI Precheck Adapter、Review、Notification、Audit 扩展 | 已完成 | 100% | `04_M4_submission_precheck_review_audit_notification_checklist.md` | 通过 |
| M5 | 包存储、下载凭证、安全校验与文件预览 | Package Storage、Download Ticket、Safe Zip、Hash、Preview、脱敏 | 已完成 | 100% | `05_M5_package_storage_download_security_preview_checklist.md` | 通过 |
| M6 | 桌面客户端后端基础、本地数据库与 IPC | Electron Main、Preload、IPC、Local DB、Secure Store、事件队列骨架 | 已完成 | 100% | `06_M6_desktop_backend_foundation_localdb_ipc_checklist.md` | 通过 |
| M7 | 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行 | ExecutionPlan、LocalExecutor、Rollback、ToolAdapter、三类扩展本地闭环 | 已完成 | 100% | `07_M7_local_executor_tool_adapter_extension_execution_checklist.md` | 通过 |
| M8 | 设备、客户端更新、备份恢复、部署与最终验收 | Device、Client Update、Backup/Restore、Offline Package、E2E Acceptance | 本地可验证门禁已收口（外部门禁保留） | 94% | `08_M8_device_update_backup_deploy_acceptance_checklist.md` | 本机验证通过；延期门禁未关 |

## 3. 阶段勾选区

- [x] M1 服务端基础工程完成并通过验收。
- [x] M2 账号、组织、会话与权限基础完成并通过验收。
- [x] M3 扩展主档、版本、授权范围、可见性、搜索与统计完成并通过验收。
- [x] M4 发布申请、系统预审、审核、审计与通知完成并通过验收。
- [x] M5 包存储、下载凭证、安全校验与文件预览完成并通过验收。
- [x] M6 桌面客户端后端基础、本地数据库与 IPC 完成并通过验收。
- [x] M7 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行完成并通过验收。
- [ ] M8 设备、客户端更新、备份恢复、部署与最终验收完成并通过验收。

## 4. 总体依赖顺序

```text
M1 服务端基础工程
  -> M2 Auth / Org / Permission
    -> M3 Extension / Scope / Search / Statistics
      -> M4 Submission / Precheck / Review / Audit / Notification
        -> M5 Package / Download / Security / Preview
          -> M6 Desktop Backend / Local DB / IPC
            -> M7 Local Executor / Tool Adapter / Skill/MCP/Plugin
              -> M8 Device / Update / Backup / Deploy / Acceptance
```

## 5. 阶段完成记录模板

### M1 完成记录

```text
状态：已完成 / 验收通过
完成时间：2026-05-07 20:50:33 CST
分支：feature/m1-backend-foundation
提交：本次提交（以 git log 为准）
验证命令：mvn test；mvn -DskipTests package；docker compose up -d --build；curl /api/health；curl /actuator/health；git diff --check；JSON manifest 校验；M1 边界扫描
验证结果：全部通过；Docker Compose API/PostgreSQL 可启动，API health healthy
遗留问题：无 M1 阻塞；Docker Hub EOF 已通过 public.ecr.aws 镜像源规避
```

### M2 完成记录

```text
状态：已完成 / 验收通过
完成时间：2026-05-07 23:05:17 CST
分支：feature/m2-auth-org-permission
提交：未提交（当前工作树）
验证命令：docker compose up -d postgres；Docker Maven `mvn -q -f server/pom.xml test`；git diff --check；JSON manifest 校验
验证结果：Docker Maven 测试通过（27 tests, 0 failures, 0 errors）；Flyway 校验 3 个迁移；统一响应/requestID/审计/M2 权限边界/幂等测试通过
遗留问题：M2 按设计明确不支持 refresh；生产初始管理员不自动 seed，需部署流程注入
```

### M3 完成记录

```text
状态：已完成 / 验收通过
完成时间：2026-05-08 10:12:24 CST
分支：main（当前工作树）
提交：未提交（当前工作树）
验证命令：Docker Maven `mvn -f server/pom.xml -Dtest=ExtensionCatalogApiTests,SubmissionReviewNotificationApiTests test`；Docker Maven `mvn -f server/pom.xml test`；git diff --check；JSON manifest 校验
验证结果：M3/M4 目标测试通过（9 tests, 0 failures, 0 errors）；全量测试通过（41 tests, 0 failures, 0 errors）；清单 109/109 项勾选；静态校验通过
遗留问题：无 M3 阻塞；真实下载/使用量事件按阶段边界留给 M5/M7
```

### M4 完成记录

```text
状态：已完成 / 验收通过
完成时间：2026-05-08 10:12:24 CST
分支：main（当前工作树）
提交：未提交（当前工作树）
验证命令：Docker Maven `mvn -f server/pom.xml -Dtest=ExtensionCatalogApiTests,SubmissionReviewNotificationApiTests test`；Docker Maven `mvn -f server/pom.xml test`；git diff --check；JSON manifest 校验
验证结果：M3/M4 目标测试通过（9 tests, 0 failures, 0 errors）；全量测试通过（41 tests, 0 failures, 0 errors）；清单 162/162 项勾选；静态校验通过
遗留问题：无 M4 阻塞；真实包上传/下载凭证/文件预览按阶段边界留给 M5
```

### M5 完成记录

```text
状态：已完成 / 验收通过
完成时间：2026-05-08 10:21:26 CST
分支：feature/m5-package-storage-download-security-preview（当前工作树）
提交：未提交（当前工作树）
验证命令：Docker Maven `mvn -q -f server/pom.xml test`；git diff --check；JSON manifest 校验
验证结果：全量测试通过（43 tests, 0 failures, 0 errors）；Flyway V1-V6 校验通过；上传/安全扫描/预览/提交消费/审核物化/下载凭证/下载事件/明文不落库测试通过；静态校验通过
遗留问题：无 M5 阻塞；CLIENT_UPDATE 实际签名/更新下载闭环按阶段边界留给 M8
```

### M6 完成记录

```text
状态：已完成 / 验收通过
完成时间：2026-05-08 13:59:15 CST
分支：main（当前工作树）
提交：未提交（当前工作树）
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron；git diff --check；JSON manifest 校验
验证结果：desktop typecheck 通过；Vitest 9 files / 17 tests 通过；lint 通过；Vite/Electron main build 通过；真实 Electron runtime isolation smoke 通过；electron-smoke 1 file / 2 tests 通过；静态校验通过
遗留问题：服务端 local-events / client-devices / client-update / MCP/Plugin 详情接口仍按 M6 边界使用 mock/contract stub，后续 M7/M8 处理；无 M6 阻塞。
```

### M7 完成记录

```text
状态：已完成
完成时间：2026-05-08
分支：main（当前工作树）
提交：未提交（当前工作树）
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron；Docker Maven `mvn -f server/pom.xml test`；git diff --check；JSON manifest 校验
验证结果：desktop typecheck 通过；Vitest 17 files / 31 tests 通过；desktop lint/build/test:electron 通过；server 48 tests 通过；git diff --check 与 JSON manifest 校验通过
遗留问题：M8 设备/更新/部署/UI 重设计按范围排除。
```

### M8 完成记录

```text
状态：首轮已验证（最终发布门禁保留）
完成时间：2026-05-08 22:31:30 CST
分支：main（当前工作树）
提交：未提交（当前工作树）；基线 5ffc916
验证命令（2026-05-08 首轮历史）：Docker Maven `mvn -f server/pom.xml test`（clean DB enterprise_agent_hub_test_m8_final_latest）；`npm --prefix desktop run typecheck`；`npm --prefix desktop test`；`npm --prefix desktop run lint`；`npm --prefix desktop run build`；`npm --prefix desktop run test:electron`；backup/restore/offline dry-run；`git diff --check`；JSON manifest 校验；Ralph architect 复审。
验证结果（2026-05-08 首轮历史）：服务端 56 tests、桌面 19 files / 42 tests、Electron smoke 1 file / 2 tests、lint/build/typecheck、脚本 dry-run、静态校验均通过；架构复审 APPROVED。2026-05-11 review 修复后 Docker Maven 服务端 58 tests、桌面 19 files / 44 tests、lint/build/typecheck、Electron smoke、脚本语法、静态校验均通过；未真实演练的发布门禁保持未勾选。
遗留问题：M8 最终完成勾选保留；真实 Windows x64 installer/signing、Web Admin UI、真实离线镜像导入/air-gapped smoke、性能计时、真实 pg_dump/restore/Compose 部署演练未完成。
```

### 桌面 Renderer 前端联通记录

```text
状态：已完成（桌面客户端 Renderer 替换 smoke screen；最终 M8 发布门禁仍保留）
完成时间：2026-05-25 CST
分支：main（当前工作树）
提交：未提交（当前工作树）
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron
验证结果：desktop typecheck 通过；Vitest 20 files / 51 tests 通过；desktop lint 通过；Vite/Electron main build 通过；Electron runtime isolation smoke 与 electron-smoke 1 file / 2 tests 通过。
交付范围：桌面 Renderer 新增 Agent/社区/本地三入口、登录/会话、社区/搜索/详情、Skill/MCP/Plugin 本地动作弹窗、发布向导/我的提交、通知、设置、改密、客户端更新；补齐 preload/IPC/API client 的 star、definition、publish、notifications、settings、local lifecycle、本地清理、MCP/Plugin 动作桥接。
未完成/未验证：未开发管理端 Web UI；未执行真实服务端全链路 E2E、真实 Windows installer/signing、真实性能计时、真实离线镜像导入、真实备份恢复/Compose 部署演练；因此不勾选 M8 最终完成。
```

### M8 设备与更新补强记录

```text
状态：已完成（本地可验证的设备与更新缺口；最终 M8 发布门禁仍保留）
完成时间：2026-05-25 CST
分支：main（当前工作树）
提交：未提交（当前工作树）
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test -- --run tests/device-heartbeat-scheduler.test.ts tests/client-update-service.test.ts tests/app-paths.test.ts tests/api-client.test.ts；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron；临时 Maven + OpenJDK 21 `mvn -q -f server/pom.xml -Dtest=ClientDeviceApiTests,ClientUpdateApiTests test`；临时 Maven + OpenJDK 21 `mvn -q -f server/pom.xml test`
验证结果：desktop typecheck 通过；新增/相关 Vitest 4 files / 19 tests 通过；desktop 全量 Vitest 21 files / 60 tests 通过；desktop lint/build/test:electron 通过；服务端目标测试通过；服务端全量 Maven 测试通过。
交付范围：桌面 Main 定时心跳调度、心跳队列数量上报、deviceID 稳定且 clientVersion 随当前构建刷新、客户端更新后首次启动 UPDATED_FIRST_START 上报、服务端版本分布聚合 API、客户端更新事件批量上报覆盖。
未完成/未验证：真实 Windows 签名包更新后首次启动 E2E、真实 Windows 安装器启动、独立 Web Admin 展示、air-gapped image import、真实性能计时、真实备份恢复/Compose 部署演练；因此不勾选 M8 最终完成。
```

## 6. 全局验收门禁

最终交付前，必须全部勾选：

- [ ] 服务端 Docker Compose 可离线部署。
- [x] PostgreSQL 数据持久化正常。（2026-05-25 一次性库 `enterprise_agent_hub_g005_gate` 真实启动服务端，`pg_dump` 后恢复到 `enterprise_agent_hub_g005_restore`，恢复后 `users=2`、`extensions=1`）
- [x] Flyway 迁移可重复验证。（2026-05-25 真实服务启动时 V1-V8 校验/迁移通过；恢复库 `flyway_schema_history` 成功记录数为 8）
- [ ] 桌面客户端 Windows x64 可构建。
- [ ] 客户端可连接内网服务端。
- [x] Web 管理端静态资源可部署或由服务端提供。（2026-05-25 新增独立 `web-admin` React/Vite 管理端；`typecheck`、`test`、`lint`、`build` 通过，`vite preview` + `curl` 验证 `dist` 静态资源可访问；服务端托管与离线镜像仍待后续门禁）
- [ ] 运行时不访问互联网。（2026-05-25 可观察检查显示本机服务进程只监听 `*:18080` 并连接 `127.0.0.1:5432`；未执行隔离网络/air-gapped smoke，保持未完成）
- [x] 三类扩展 Skill、MCP Server、Plugin 均具备发布、审核、展示、安装或接入、更新、卸载、统计、审计闭环。
- [x] 授权范围与可见选项由服务端权威判断。
- [x] 停用、卸载和本地清理不因授权收缩而被禁止。
- [x] 审计日志可按 requestID 查询。
- [x] 客户端设备、版本分布、更新失败事件可查询。（2026-05-25 设备列表/详情事件、版本分布聚合 API、更新失败事件 API 已通过服务端测试；独立 Web Admin 已实现设备/版本分布/更新事件页面并通过静态构建验证）
- [x] 备份脚本可执行。
- [x] 恢复脚本可执行。（2026-05-25 真实 `pg_restore`、文件恢复、checksum、Flyway 检查和恢复健康检查通过）
- [x] 所有测试通过。（2026-05-25 最终验收：desktop typecheck、Vitest 21 files / 60 tests、lint/build/test:electron 1 file / 3 tests 通过；服务端 Maven 20 suites / 58 tests / 0 failures / 0 errors / 0 skipped；独立 `web-admin` typecheck、Vitest 2 files / 7 tests、lint/build 通过；脚本语法、diff whitespace、JSON manifest 校验通过）
- [ ] 所有阶段子清单已完成并更新。

## 7. 2026-05-25 剩余发布门禁对账

### 7.1 对账依据

已复核：

- `AGENTS.md`
- `docs/DevelopmentTasks/00_MASTER_STAGE_CHECKLIST.md`
- `docs/DevelopmentTasks/07_M7_local_executor_tool_adapter_extension_execution_checklist.md`
- `docs/DevelopmentTasks/08_M8_device_update_backup_deploy_acceptance_checklist.md`
- `docs/DevelopmentTasks/09_AGENT_WORKING_RULES.md`
- `docs/RequirementDocument/15_admin_audit_updates_settings.md`
- `docs/RequirementDocument/20_non_functional_deployment.md`
- `docs/RequirementDocument/22_acceptance_checklist.md`
- `docs/DetailedDesign/13_配置_部署_备份恢复.md`
- `docs/DetailedDesign/15_测试策略与开发切片.md`
- `docs/UIDesign/FrontendLayoutPrototypeDocument_revised.md`

本次只完成剩余门禁对账，不勾选任何未经过新增验证的完成项。

### 7.2 可本地继续完成的事项

| 后续目标 | 范围 | 当前证据 | 完成判定 |
|---|---|---|---|
| M7 增强遗留 | MCP 变量新增/删除提示、manual-download 安装说明入口、MCP 更新/卸载等本地事件、服务端状态提示刷新、恢复联网后同步并刷新状态 | M7 清单仍有 7 项增强遗留；桌面 Renderer 与 IPC 已具备本地动作基础 | `npm --prefix desktop run typecheck/test/lint/build/test:electron` 全部通过，并更新 M7 清单对应项 |
| M8 设备与更新 | 定期心跳调度、更新后首次启动版本上报、版本分布/设备事件查询、更新失败事件管理端展示基础 | 2026-05-25 已补桌面心跳调度、启动版本上报、设备版本分布 API 与更新后首次启动事件测试 | 服务端/桌面测试覆盖新增行为；真实 Windows 签名包 E2E 与独立 Web Admin 展示未执行则保持对应门禁未勾选 |
| 独立 Web Admin | A-00 到 A-17 的独立 React 管理端基础页面，不进入桌面客户端导航 | 2026-05-25 新增 `web-admin` 包，覆盖登录、概览、审核、扩展治理、部门用户、审计详情关联、设备/版本分布、客户端更新、系统设置；系统级入口按角色隐藏；桌面一级导航仍只有 Agent/社区/本地 | `npm --prefix web-admin run typecheck/test/lint/build` 通过；`vite preview` + `curl` 验证静态资源可访问；服务端托管和离线镜像打包仍留给部署门禁 |
| 部署、备份、恢复、离线 | Compose health、PostgreSQL 持久化、Flyway 重复验证、备份/恢复 disposable 演练、离线包脚本检查 | 2026-05-25 本机真实服务端健康、PostgreSQL `pg_dump`/`pg_restore`、checksum、文件恢复、Flyway 检查、离线脚本 dry-run 通过；Docker daemon 不可连接且无真实 `api.tar`/`web-admin.tar` | 已完成本机可验证演练；镜像 tar、Compose 服务部署和 air-gapped import 只在真实构建/导入后勾选，不创建假 tar |
| 性能验收 | 社区首页、搜索、详情、审核列表、审计日志、设备列表限时测量 | 2026-05-25 使用本机真实服务端和登录 token 计时：14.6ms、9.7ms、6.1ms、6.3ms、7.5ms、7.6ms | 六个指定端点均低于阈值；真实性能门禁已完成 |

### 7.3 必须保留为外部环境门禁的事项

以下事项没有当前机器上的真实证据时不得勾选：

- Windows x64 安装包真实构建、签名和安装器启动 E2E。
- 真实企业内网服务端与桌面客户端全链路联调。
- 真实离线镜像 `api.tar`、`web-admin.tar` 导入和 air-gapped smoke。
- 生产数据规模或生产环境 PostgreSQL 恢复演练。
- 运行时无互联网访问的隔离网络验证。

### 7.4 当前工作树注意事项

- `AGENTS.md` 已有本地修改，后续实现不得回退用户或既有改动。
- 桌面 Renderer 收口产生大量未提交文件；后续阶段应复用，不重新实现 smoke screen 或管理端入口。
- Web 管理端如开发，必须作为独立 React 管理端，不得把部门、用户、审核、审计或客户端更新发布页面塞入桌面客户端。

### 7.5 最终质量门记录

```text
复核时间：2026-05-25 CST（Ultragoal G006 最终验收）
质量门：targeted verification、changed-file slop scan、post-cleaner verification、code review 均通过。
修复内容：LocalEventsSyncApiTests 改为每次生成唯一 deviceId/idempotencyKey，避免重复执行时被历史幂等记录误判为 IGNORED；确认桌面登录弹窗关闭按钮由 `desktop/tests/renderer-app.test.tsx` 覆盖；`.gitignore` 排除 `web-admin/node_modules/` 和 `web-admin/dist/`。
验证命令：`npm --prefix desktop run typecheck && npm --prefix desktop test && npm --prefix desktop run lint && npm --prefix desktop run build && npm --prefix desktop run test:electron`；`npm --prefix web-admin run typecheck && npm --prefix web-admin test && npm --prefix web-admin run lint && npm --prefix web-admin run build`；`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home /tmp/apache-maven-3.9.9/bin/mvn -q -f server/pom.xml test`；`bash -n scripts/backup.sh scripts/restore.sh scripts/healthcheck.sh deploy/offline/enterprise-agent-hub-server/scripts/*.sh && git diff --check && python3 -m json.tool docs/DetailedDesign/MANIFEST.json >/dev/null && python3 -m json.tool docs/DevelopmentTasks/MANIFEST.json >/dev/null`。
验证结果：desktop 21 files / 60 tests + Electron smoke 1 file / 3 tests；web-admin 2 files / 7 tests；server 20 suites / 58 tests；所有命令退出码为 0。
未勾选项：Docker daemon 不可用导致服务端镜像 Compose 部署未执行；无真实 image tar 导致离线导入未执行；无 Windows 签名安装包和真实企业内网环境，相关 E2E 保持未完成。
```
