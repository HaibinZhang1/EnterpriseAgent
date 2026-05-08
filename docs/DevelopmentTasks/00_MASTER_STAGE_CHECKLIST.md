# 00. EnterpriseAgent 总阶段清单：M1-M8

> 本文件用于统计整体开发进度。Agent 每完成一个阶段，必须同步更新本文件。
>
> 勾选规则：只有对应子清单中的“阶段完成定义”和“验收命令”全部通过，才允许在本总清单中勾选阶段完成。

## 1. 总体状态

| 字段 | 当前值 | 更新说明 |
|---|---|---|
| 项目 | EnterpriseAgent / Enterprise Agent Hub | 固定 |
| 当前阶段 | M7 | Agent 每次开始新阶段时更新 |
| 总阶段数 | 8 | M1-M8 |
| 总体完成率 | 87% | M1-M6 已完成，M7 核心闭环 95%，M8 未开始 |
| 当前分支 | main（当前工作树） | Agent 填写 |
| 最近提交 | 未提交（当前工作树）；上次提交 `2934d4d` | Agent 填写 commit hash |
| 最近验证时间 | 2026-05-08 16:14:07 CST | Agent 填写 |
| 当前阻塞项 | M7 核心闭环已通过；7 项增强遗留 | Agent 填写 |
| 下一阶段 | M7 遗留增强收口 / M8（待授权） | Agent 更新 |

## 2. M1-M8 阶段总览

| 阶段 | 名称 | 目标 | 状态 | 完成率 | 子清单 | 验收结论 |
|---|---|---|---|---:|---|---|
| M1 | 服务端基础工程 | Spring Boot 3 + Java 21 + PostgreSQL + Flyway + Docker Compose 基础可运行 | 已完成 | 100% | `01_M1_backend_foundation_checklist.md` | 通过 |
| M2 | 账号、组织、会话与权限基础 | Auth、User、Department、Session、角色、权限边界 | 已完成 | 100% | `02_M2_auth_org_permission_checklist.md` | 通过 |
| M3 | 扩展主档、版本、授权范围、可见性、搜索与统计 | Extension、Version、Scope、Visibility、Search、Star、Statistics | 已完成 | 100% | `03_M3_extension_catalog_scope_statistics_checklist.md` | 通过 |
| M4 | 发布申请、系统预审、审核、审计与通知 | Submission、Revision、Rule Precheck、AI Precheck Adapter、Review、Notification、Audit 扩展 | 已完成 | 100% | `04_M4_submission_precheck_review_audit_notification_checklist.md` | 通过 |
| M5 | 包存储、下载凭证、安全校验与文件预览 | Package Storage、Download Ticket、Safe Zip、Hash、Preview、脱敏 | 已完成 | 100% | `05_M5_package_storage_download_security_preview_checklist.md` | 通过 |
| M6 | 桌面客户端后端基础、本地数据库与 IPC | Electron Main、Preload、IPC、Local DB、Secure Store、事件队列骨架 | 已完成 | 100% | `06_M6_desktop_backend_foundation_localdb_ipc_checklist.md` | 通过 |
| M7 | 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行 | ExecutionPlan、LocalExecutor、Rollback、ToolAdapter、三类扩展本地闭环 | 已完成（核心闭环） | 95% | `07_M7_local_executor_tool_adapter_extension_execution_checklist.md` | 通过（7 项增强遗留） |
| M8 | 设备、客户端更新、备份恢复、部署与最终验收 | Device、Client Update、Backup/Restore、Offline Package、E2E Acceptance | 未开始 | 0% | `08_M8_device_update_backup_deploy_acceptance_checklist.md` | 待验收 |

## 3. 阶段勾选区

- [x] M1 服务端基础工程完成并通过验收。
- [x] M2 账号、组织、会话与权限基础完成并通过验收。
- [x] M3 扩展主档、版本、授权范围、可见性、搜索与统计完成并通过验收。
- [x] M4 发布申请、系统预审、审核、审计与通知完成并通过验收。
- [x] M5 包存储、下载凭证、安全校验与文件预览完成并通过验收。
- [x] M6 桌面客户端后端基础、本地数据库与 IPC 完成并通过验收。
- [ ] M7 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行完成并通过验收。
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
状态：已完成（核心闭环）
完成时间：2026-05-08
分支：main（当前工作树）
提交：未提交（当前工作树）
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron；Docker Maven `mvn -f server/pom.xml test`；git diff --check；JSON manifest 校验
验证结果：desktop typecheck 通过；Vitest 17 files / 31 tests 通过；desktop lint/build/test:electron 通过；server 48 tests 通过；git diff --check 与 JSON manifest 校验通过
遗留问题：MCP HTTP 连接检测实际执行、MCP 变量增删交互提示、manual-download 打开说明、serverStateHints 自动刷新本地状态等 7 项增强遗留；M8 设备/更新/部署/UI 重设计按范围排除。
```

### M8 完成记录

```text
状态：
完成时间：
分支：
提交：
验证命令：
验证结果：
遗留问题：
```

## 6. 全局验收门禁

最终交付前，必须全部勾选：

- [ ] 服务端 Docker Compose 可离线部署。
- [ ] PostgreSQL 数据持久化正常。
- [ ] Flyway 迁移可重复验证。
- [ ] 桌面客户端 Windows x64 可构建。
- [ ] 客户端可连接内网服务端。
- [ ] Web 管理端静态资源可部署或由服务端提供。
- [ ] 运行时不访问互联网。
- [ ] 三类扩展 Skill、MCP Server、Plugin 均具备发布、审核、展示、安装或接入、更新、卸载、统计、审计闭环。
- [ ] 授权范围与可见选项由服务端权威判断。
- [ ] 停用、卸载和本地清理不因授权收缩而被禁止。
- [ ] 审计日志可按 requestID 查询。
- [ ] 客户端设备、版本分布、更新失败事件可查询。
- [ ] 备份脚本可执行。
- [ ] 恢复脚本可执行。
- [ ] 所有测试通过。
- [ ] 所有阶段子清单已完成并更新。
