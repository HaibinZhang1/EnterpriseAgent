# EnterpriseAgent Agent 开发阶段清单包

生成时间：2026-05-07 11:26:17

本清单包用于指导 Agent 按阶段开发 EnterpriseAgent，包含 1 个总阶段清单、8 个阶段子清单、1 个 Agent 执行规则文档和 1 个 MANIFEST 索引文件。

## 文件说明

| 文件 | 作用 |
|---|---|
| `00_MASTER_STAGE_CHECKLIST.md` | 总阶段清单，统计 M1-M8 总体状态、完成率、验收结论和阻塞项。 |
| `01_M1_backend_foundation_checklist.md` | M1：服务端基础工程。 |
| `02_M2_auth_org_permission_checklist.md` | M2：账号、组织、会话与权限基础。 |
| `03_M3_extension_catalog_scope_statistics_checklist.md` | M3：扩展主档、版本、授权范围、可见性、搜索与统计。 |
| `04_M4_submission_precheck_review_audit_notification_checklist.md` | M4：发布申请、系统预审、审核、审计与通知。 |
| `05_M5_package_storage_download_security_preview_checklist.md` | M5：包存储、下载凭证、安全校验与文件预览。 |
| `06_M6_desktop_backend_foundation_localdb_ipc_checklist.md` | M6：桌面客户端后端基础、本地数据库与 IPC。 |
| `07_M7_local_executor_tool_adapter_extension_execution_checklist.md` | M7：本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行。 |
| `08_M8_device_update_backup_deploy_acceptance_checklist.md` | M8：客户端设备、客户端更新、备份恢复、部署与最终验收。 |
| `09_AGENT_WORKING_RULES.md` | Agent 工作规则、勾选规则、禁止事项、提交规范。 |
| `MANIFEST.json` | 阶段定义、文件索引、建议分支和建议提交信息。 |

## 推荐仓库落点

把本目录整体放入：

```text
docs/DevelopmentTasks/
```

建议结构：

```text
docs/DevelopmentTasks/
├── 00_MASTER_STAGE_CHECKLIST.md
├── 01_M1_backend_foundation_checklist.md
├── 02_M2_auth_org_permission_checklist.md
├── 03_M3_extension_catalog_scope_statistics_checklist.md
├── 04_M4_submission_precheck_review_audit_notification_checklist.md
├── 05_M5_package_storage_download_security_preview_checklist.md
├── 06_M6_desktop_backend_foundation_localdb_ipc_checklist.md
├── 07_M7_local_executor_tool_adapter_extension_execution_checklist.md
├── 08_M8_device_update_backup_deploy_acceptance_checklist.md
├── 09_AGENT_WORKING_RULES.md
└── MANIFEST.json
```

## 使用要求

1. Agent 每次按工作量安排执行几个 M 阶段。
2. 阶段开始前必须阅读 `00_MASTER_STAGE_CHECKLIST.md` 和对应子清单。
3. 每完成一项任务，Agent 必须把 `[ ]` 改成 `[x]`。
4. 未实际验证的任务不得勾选。
5. 阶段完成后，Agent 必须更新总清单中的状态、完成率、验证命令、验证结果和遗留问题。
6. 每个阶段使用独立分支、独立提交或 PR。
7. 不允许跨阶段一次性生成大量代码。
