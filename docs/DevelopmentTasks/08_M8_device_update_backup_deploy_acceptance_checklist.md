# 08. M8 设备、客户端更新、备份恢复、部署与最终验收清单

## 1. 阶段目标

完成客户端设备登记、心跳、版本分布、客户端更新包发布与下载校验、备份恢复脚本、离线部署包、最终集成测试和验收闭环。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M8 |
| 名称 | 设备、客户端更新、备份恢复、部署与最终验收 |
| 状态 | 未开始 |
| 完成率 | 0% |
| 分支 | feature/m8-device-update-backup-deploy-acceptance |
| 开始时间 | 待填写 |
| 完成时间 | 待填写 |
| 提交 Commit | 待填写 |
| 负责人 / Agent | 待填写 |
| 验收结论 | 待验收 |

## 3. 前置条件

- [ ] M1-M7 已完成。
- [ ] 服务端、客户端后端、本地执行层均可运行。
- [ ] 关键功能有测试覆盖。
- [ ] Docker Compose 可启动服务端和数据库。

## 4. 输入文档

- [ ] 阅读 `docs/RequirementDocument/15_admin_audit_updates_settings.md`。
- [ ] 阅读 `docs/RequirementDocument/16_core_flows.md` 客户端设备、客户端更新、离线同步、审计查询流程。
- [ ] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 部署、备份、恢复、测试要求。
- [ ] 阅读 `docs/RequirementDocument/22_acceptance_checklist.md`。
- [ ] 阅读 `docs/DetailedDesign/13_配置_部署_备份恢复.md`。
- [ ] 阅读 `docs/DetailedDesign/15_测试策略与开发切片.md`。
- [ ] 阅读 `docs/DetailedDesign/19_接口契约_OpenAPI补充.md` 设备、更新、设置接口。

## 5. 数据库迁移任务

- [ ] 创建 `V6__device_update_deploy_foundation.sql` 或按已有迁移编号递增。
- [ ] 创建 `client_devices` 表。
- [ ] 创建设备唯一索引 device_id。
- [ ] 保存 user_id、department_id、hostname_hash、os_version、arch、client_version、first_seen_at、last_seen_at、status。
- [ ] 创建 `client_device_events` 表。
- [ ] 创建 `client_versions` 表。
- [ ] 保存 version、build_no、package_hash、signature_status、status、published_at。
- [ ] 创建 `client_update_events` 表。
- [ ] 创建必要索引：device_id、user_id、department_id、client_version、created_at。

## 6. 客户端设备服务端任务

- [ ] 创建 ClientDevice Entity 和 Repository。
- [ ] 创建 ClientDeviceService。
- [ ] 登录成功后登记设备。
- [ ] 支持设备心跳。
- [ ] 支持版本摘要上报。
- [ ] 支持设备状态更新。
- [ ] 支持设备列表分页查询。
- [ ] 部门管理员只能查看管理范围内用户设备。
- [ ] 系统管理员可查看全局设备。
- [ ] 支持设备详情查询。
- [ ] 支持设备事件查询。
- [ ] 设备事件关联 requestID 和 local event。

## 7. 客户端设备客户端任务

- [ ] 客户端首次启动生成 deviceID。
- [ ] deviceID 后续保持稳定。
- [ ] 登录成功后调用设备登记 API。
- [ ] 定期上报心跳。
- [ ] 上报客户端版本、OS、架构。
- [ ] 本地事件异常可关联 deviceID。
- [ ] 更新事件可关联 deviceID。
- [ ] 日志不记录 hostname 明文，如设计要求应保存 hash。

## 8. 客户端更新服务端任务

- [ ] 创建 ClientUpdateService。
- [ ] 系统管理员可创建客户端版本。
- [ ] 系统管理员可上传或登记 Windows x64 安装包。
- [ ] 校验版本号。
- [ ] 校验安装包 Hash。
- [ ] 保存签名状态。
- [ ] 发布更新。
- [ ] 暂停更新。
- [ ] 撤回更新。
- [ ] 客户端检查更新接口。
- [ ] 客户端申请更新包下载凭证。
- [ ] 更新包下载事件记录。
- [ ] 更新失败事件记录。
- [ ] 更新发布、暂停、撤回写审计。

## 9. 客户端更新客户端任务

- [ ] 客户端启动或登录时检查更新。
- [ ] 携带 deviceID 和当前版本。
- [ ] 有更新时产生通知。
- [ ] 用户确认后申请下载凭证。
- [ ] 下载更新包到临时目录。
- [ ] 校验 Hash。
- [ ] 校验安装包签名。
- [ ] Hash 或签名失败时拒绝安装并上报事件。
- [ ] 校验通过后启动安装程序。
- [ ] 更新后首次启动上报新版本。

## 10. 设置管理任务

- [ ] SettingsService 支持 expectedVersion 乐观锁。
- [ ] `settings.version` 每次成功更新 +1。
- [ ] 设置变更写 settings_history。
- [ ] 设置变更写审计。
- [ ] 支持上传限制配置。
- [ ] 支持 AI 预审配置。
- [ ] 支持审计保留配置。
- [ ] 支持客户端更新策略配置。
- [ ] 支持安全下架存量策略配置。
- [ ] API Key 等敏感设置脱敏展示。

## 11. 备份脚本任务

- [ ] 创建 `scripts/backup.sh`。
- [ ] 备份 PostgreSQL 数据。
- [ ] 备份扩展包文件。
- [ ] 备份 MCP 定义清单。
- [ ] 备份 Plugin 包和安装清单。
- [ ] 备份客户端更新包。
- [ ] 备份配置文件。
- [ ] 备份文件名包含日期、版本、环境。
- [ ] 备份完成输出校验摘要。
- [ ] 备份失败返回非零退出码。
- [ ] 支持默认保留最近 7 次或可配置保留策略。

## 12. 恢复脚本任务

- [ ] 创建 `scripts/restore.sh`。
- [ ] 恢复前提示会覆盖当前数据。
- [ ] 恢复前检查备份完整性。
- [ ] 恢复 PostgreSQL 数据。
- [ ] 恢复包文件。
- [ ] 恢复配置文件。
- [ ] 恢复后执行 Flyway 状态检查。
- [ ] 恢复后检查包文件存在性。
- [ ] 恢复失败输出明确失败位置。
- [ ] 恢复完成后健康检查通过。

## 13. 离线部署包任务

- [ ] 创建离线部署目录结构。
- [ ] 包含 `docker-compose.yml`。
- [ ] 包含 `images/api.tar`。
- [ ] 包含 `images/web-admin.tar`，如已有 Web 管理端静态资源镜像。
- [ ] 包含 `images/postgres.tar` 或企业可接受的数据库镜像说明。
- [ ] 包含 `config/app.example.env`。
- [ ] 包含 `config/storage.example.yml`。
- [ ] 包含 `config/ai-precheck.example.yml`。
- [ ] 包含 `scripts/load-images.sh`。
- [ ] 包含 `scripts/install.sh`。
- [ ] 包含 `scripts/backup.sh`。
- [ ] 包含 `scripts/restore.sh`。
- [ ] 包含 `scripts/healthcheck.sh`。
- [ ] 包含部署 README。
- [ ] 运行时不访问互联网。

## 14. 审计查询与排障任务

- [ ] 审计日志支持按 requestID 查询。
- [ ] 审计日志支持按用户查询。
- [ ] 审计日志支持按对象类型和对象 ID 查询。
- [ ] 审计日志支持按动作和时间范围查询。
- [ ] 审计日志按管理员管理范围过滤。
- [ ] 审计日志可导出 CSV。
- [ ] 审计详情可跳转或关联用户、扩展、申请、设备、更新记录。
- [ ] 运行日志和审计日志 requestID 可关联。
- [ ] 本地事件和设备事件可关联。

## 15. 端到端验收任务

- [ ] 服务端 Docker Compose 启动。
- [ ] 管理员登录。
- [ ] 创建部门和用户。
- [ ] 普通用户登录桌面客户端。
- [ ] 用户提交 Skill 发布申请。
- [ ] 规则预审和 AI 预审生成结果。
- [ ] 管理员审核通过。
- [ ] 社区可搜索 Skill。
- [ ] 授权用户安装 Skill。
- [ ] Skill 启用到工具或项目 dry-run 或测试目录。
- [ ] 用户提交 MCP 发布申请。
- [ ] 管理员审核通过。
- [ ] 授权用户写入 MCP 配置 dry-run 或测试配置。
- [ ] 用户提交 Plugin 发布申请。
- [ ] managed-package 或 config-plugin 跑通测试目录安装。
- [ ] manual-download 跑通受控下载和标记已安装。
- [ ] 授权收缩后禁止新增主操作。
- [ ] 授权收缩后允许停用和卸载。
- [ ] 展示收缩后未授权用户不可搜索。
- [ ] 下架后不可新增安装。
- [ ] 安全下架后本地显示风险或执行策略。
- [ ] 审计日志可查上述关键操作。
- [ ] 客户端设备可登记和心跳。
- [ ] 客户端更新检查、下载校验、事件上报可用。
- [ ] 备份脚本可执行。
- [ ] 恢复脚本可执行并健康检查通过。

## 16. 性能与安全验收任务

- [ ] 社区首页 2 秒内返回主要数据。
- [ ] 搜索结果第一页 2 秒内返回。
- [ ] 扩展详情 1 秒内返回基础信息。
- [ ] 审核列表 2 秒内返回第一页。
- [ ] 审计日志查询 3 秒内返回第一页。
- [ ] 客户端设备列表 3 秒内返回第一页。
- [ ] 上传包校验路径穿越、绝对路径、解压逃逸。
- [ ] 客户端更新包校验 Hash 和签名。
- [ ] 密码、Token、API Key、下载凭证不进入日志。
- [ ] MCP 敏感变量不保存服务端。
- [ ] AI 预审输入脱敏。
- [ ] 运行时不访问互联网。

## 17. 测试任务

- [ ] 服务端单元测试全部通过。
- [ ] 服务端集成测试全部通过。
- [ ] 客户端单元测试全部通过。
- [ ] 客户端 IPC 测试通过。
- [ ] 客户端本地执行测试通过。
- [ ] 端到端测试通过。
- [ ] Docker Compose 测试通过。
- [ ] 备份恢复测试通过。
- [ ] 离线部署包导入测试通过。
- [ ] 安全测试通过。

## 18. 阶段验收

- [ ] 客户端设备登记、心跳、版本分布可用。
- [ ] 客户端更新发布、检查、下载、Hash 和签名校验可用。
- [ ] Settings 乐观锁可用。
- [ ] 备份和恢复脚本可执行。
- [ ] 离线部署包可用。
- [ ] 审计查询和 requestID 排障链路完整。
- [ ] 三类扩展端到端闭环通过。
- [ ] 授权范围、可见选项、下架、安全下架规则通过。
- [ ] 性能和安全验收通过。
- [ ] 所有阶段子清单已更新。
- [ ] 总清单所有阶段完成。

## 19. 阶段完成记录

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
