# 00. EnterpriseAgent 总阶段清单：M1-M8

> 本文件用于统计整体开发进度。Agent 每完成一个阶段，必须同步更新本文件。
>
> 勾选规则：只有对应子清单中的“阶段完成定义”和“验收命令”全部通过，才允许在本总清单中勾选阶段完成。

## 1. 总体状态

| 字段 | 当前值 | 更新说明 |
|---|---|---|
| 项目 | EnterpriseAgent / Enterprise Agent Hub | 固定 |
| 当前阶段 | M1 | Agent 每次开始新阶段时更新 |
| 总阶段数 | 8 | M1-M8 |
| 总体完成率 | 12.5% | M1 已完成，1/8 阶段通过验收 |
| 当前分支 | feature/m1-backend-foundation | Agent 填写 |
| 最近提交 | 本次提交（以 git log 为准） | Agent 填写 commit hash |
| 最近验证时间 | 2026-05-07 20:50:33 CST | Agent 填写 |
| 当前阻塞项 | 无 M1 阻塞 | Agent 填写 |
| 下一阶段 | M2 账号、组织、会话与权限基础 | Agent 更新 |

## 2. M1-M8 阶段总览

| 阶段 | 名称 | 目标 | 状态 | 完成率 | 子清单 | 验收结论 |
|---|---|---|---|---:|---|---|
| M1 | 服务端基础工程 | Spring Boot 3 + Java 21 + PostgreSQL + Flyway + Docker Compose 基础可运行 | 已完成 | 100% | `01_M1_backend_foundation_checklist.md` | 通过 |
| M2 | 账号、组织、会话与权限基础 | Auth、User、Department、Session、角色、权限边界 | 未开始 | 0% | `02_M2_auth_org_permission_checklist.md` | 待验收 |
| M3 | 扩展主档、版本、授权范围、可见性、搜索与统计 | Extension、Version、Scope、Visibility、Search、Star、Statistics | 未开始 | 0% | `03_M3_extension_catalog_scope_statistics_checklist.md` | 待验收 |
| M4 | 发布申请、系统预审、审核、审计与通知 | Submission、Revision、Rule Precheck、AI Precheck Adapter、Review、Notification、Audit 扩展 | 未开始 | 0% | `04_M4_submission_precheck_review_audit_notification_checklist.md` | 待验收 |
| M5 | 包存储、下载凭证、安全校验与文件预览 | Package Storage、Download Ticket、Safe Zip、Hash、Preview、脱敏 | 未开始 | 0% | `05_M5_package_storage_download_security_preview_checklist.md` | 待验收 |
| M6 | 桌面客户端后端基础、本地数据库与 IPC | Electron Main、Preload、IPC、Local DB、Secure Store、事件队列骨架 | 未开始 | 0% | `06_M6_desktop_backend_foundation_localdb_ipc_checklist.md` | 待验收 |
| M7 | 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行 | ExecutionPlan、LocalExecutor、Rollback、ToolAdapter、三类扩展本地闭环 | 未开始 | 0% | `07_M7_local_executor_tool_adapter_extension_execution_checklist.md` | 待验收 |
| M8 | 设备、客户端更新、备份恢复、部署与最终验收 | Device、Client Update、Backup/Restore、Offline Package、E2E Acceptance | 未开始 | 0% | `08_M8_device_update_backup_deploy_acceptance_checklist.md` | 待验收 |

## 3. 阶段勾选区

- [x] M1 服务端基础工程完成并通过验收。
- [ ] M2 账号、组织、会话与权限基础完成并通过验收。
- [ ] M3 扩展主档、版本、授权范围、可见性、搜索与统计完成并通过验收。
- [ ] M4 发布申请、系统预审、审核、审计与通知完成并通过验收。
- [ ] M5 包存储、下载凭证、安全校验与文件预览完成并通过验收。
- [ ] M6 桌面客户端后端基础、本地数据库与 IPC 完成并通过验收。
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
状态：
完成时间：
分支：
提交：
验证命令：
验证结果：
遗留问题：
```

### M3 完成记录

```text
状态：
完成时间：
分支：
提交：
验证命令：
验证结果：
遗留问题：
```

### M4 完成记录

```text
状态：
完成时间：
分支：
提交：
验证命令：
验证结果：
遗留问题：
```

### M5 完成记录

```text
状态：
完成时间：
分支：
提交：
验证命令：
验证结果：
遗留问题：
```

### M6 完成记录

```text
状态：
完成时间：
分支：
提交：
验证命令：
验证结果：
遗留问题：
```

### M7 完成记录

```text
状态：
完成时间：
分支：
提交：
验证命令：
验证结果：
遗留问题：
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
