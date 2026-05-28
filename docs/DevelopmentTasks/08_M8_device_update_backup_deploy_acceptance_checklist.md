# 08. M8 设备、客户端更新、备份恢复、部署与最终验收清单

## 1. 阶段目标

完成客户端设备登记、心跳、版本分布、客户端更新包发布与下载校验、备份恢复脚本、离线部署包、最终集成测试和验收闭环。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M8 |
| 名称 | 设备、客户端更新、备份恢复、部署与最终验收 |
| 状态 | 首轮已验证（延期门禁保留） |
| 完成率 | 94%（167/178 项；最终发布门禁未关） |
| 分支 | feature/m8-device-update-backup-deploy-acceptance |
| 开始时间 | 2026-05-08 |
| 完成时间 | 2026-05-08 22:31:30 CST（首轮验证） |
| 提交 Commit | 未提交（当前工作树）；基线 `5ffc916` |
| 负责人 / Agent | Codex Ralph |
| 验收结论 | 首轮部分通过；Windows 签名包、Web Admin 离线镜像/服务端托管、真实离线镜像包、Docker Compose 服务部署、air-gapped smoke 延期 |

## 3. 前置条件

- [x] M1-M7 核心闭环已完成；M7 增强遗留按 M8 gate override 不阻塞首轮。
- [x] 服务端、客户端后端、本地执行层均可运行。
- [x] 关键功能有测试覆盖。
- [ ] Docker Compose 可启动服务端和数据库。（本轮使用 Docker Compose PostgreSQL + Docker Maven；未重跑服务端 Compose 镜像部署）

## 4. 输入文档

- [x] 阅读 `docs/RequirementDocument/15_admin_audit_updates_settings.md`。
- [x] 阅读 `docs/RequirementDocument/16_core_flows.md` 客户端设备、客户端更新、离线同步、审计查询流程。
- [x] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 部署、备份、恢复、测试要求。
- [x] 阅读 `docs/RequirementDocument/22_acceptance_checklist.md`。
- [x] 阅读 `docs/DetailedDesign/13_配置_部署_备份恢复.md`。
- [x] 阅读 `docs/DetailedDesign/15_测试策略与开发切片.md`。
- [x] 阅读 `docs/DetailedDesign/19_接口契约_OpenAPI补充.md` 设备、更新、设置接口。

## 5. 数据库迁移任务

- [x] 创建 `V8__device_update_deploy_foundation.sql`（按已有迁移编号递增）。
- [x] 创建 `client_devices` 表。
- [x] 创建设备唯一索引 device_id。
- [x] 保存 user_id、department_id、hostname_hash、os_version、arch、client_version、first_seen_at、last_seen_at、status。
- [x] 创建 `client_device_events` 表。
- [x] 创建 `client_versions` 表。
- [x] 保存 version、build_no、package_hash、signature_status、status、published_at。
- [x] 创建 `client_update_events` 表。
- [x] 创建必要索引：device_id、user_id、department_id、client_version、created_at。

## 6. 客户端设备服务端任务

- [ ] 创建 ClientDevice Entity 和 Repository。（首轮采用 `JdbcTemplate` 服务实现，未新增 JPA Entity/Repository）
- [x] 创建 ClientDeviceService。
- [x] 登录成功后登记设备。
- [x] 支持设备心跳。
- [x] 支持版本摘要上报。
- [x] 支持设备状态更新。
- [x] 支持设备列表分页查询。
- [x] 部门管理员只能查看管理范围内用户设备。
- [x] 系统管理员可查看全局设备。
- [x] 支持设备详情查询。
- [x] 支持设备事件查询。
- [x] 设备事件关联 requestID 和 local event。

## 7. 客户端设备客户端任务

- [x] 客户端首次启动生成 deviceID。
- [x] deviceID 后续保持稳定。
- [x] 登录成功后调用设备登记 API。
- [x] 定期上报心跳。（2026-05-25 已接入 Main 进程心跳调度器并覆盖队列数量上报测试）
- [x] 上报客户端版本、OS、架构。
- [x] 本地事件异常可关联 deviceID。
- [x] 更新事件可关联 deviceID。
- [x] 日志不记录 hostname 明文，如设计要求应保存 hash。

## 8. 客户端更新服务端任务

- [x] 创建 ClientUpdateService。
- [x] 系统管理员可创建客户端版本。
- [x] 系统管理员可上传或登记 Windows x64 安装包元数据与临时包。（真实 Windows 签名产物延期）
- [x] 校验版本号。
- [x] 校验安装包 Hash。
- [x] 保存签名状态。
- [x] 发布更新。
- [x] 暂停更新。
- [x] 撤回更新。
- [x] 客户端检查更新接口。
- [x] 客户端申请更新包下载凭证。
- [x] 更新包下载事件记录。
- [x] 更新失败事件记录。
- [x] 更新发布、暂停、撤回写审计。

## 9. 客户端更新客户端任务

- [x] 客户端启动或登录时检查更新。
- [x] 携带 deviceID 和当前版本。
- [x] 有更新时产生通知。
- [x] 用户确认后申请下载凭证。
- [x] 下载更新包到临时目录。
- [x] 校验 Hash。
- [x] 校验安装包签名。（默认走 Windows Authenticode 本机校验并 fail closed；真实 Windows 签名产物 E2E 验证延期）
- [x] Hash 或签名失败时拒绝安装并上报事件。
- [x] 校验通过后调用安装器启动抽象。（默认 Windows launcher 会真实调用安装器；真实 Windows 安装器端到端启动延期到签名产物）
- [x] 更新后首次启动上报新版本。（2026-05-25 已补启动版本状态文件与 UPDATED_FIRST_START 上报；真实 Windows 更新后启动 E2E 仍未执行）

## 10. 设置管理任务

- [x] SettingsService 支持 expectedVersion 乐观锁。
- [x] `settings.version` 每次成功更新 +1。
- [x] 设置变更写 settings_history。
- [x] 设置变更写审计。
- [x] 支持上传限制配置。
- [x] 支持 AI 预审配置。
- [x] 支持审计保留配置。
- [x] 支持客户端更新策略配置。
- [x] 支持安全下架存量策略配置。
- [x] API Key 等敏感设置脱敏展示。

## 11. 备份脚本任务

- [x] 创建 `scripts/backup.sh`。
- [x] 备份 PostgreSQL 数据。（2026-05-25 使用 PostgreSQL 17.9 本机一次性库 `enterprise_agent_hub_g005_gate` 执行真实 `pg_dump`；默认 `pg_dump` 16.13 因服务端 17.9 版本不匹配失败后，改用 `/opt/homebrew/Cellar/postgresql@17/17.9/bin/pg_dump` 通过）
- [x] 备份扩展包文件。
- [x] 备份 MCP 定义清单。
- [x] 备份 Plugin 包和安装清单。
- [x] 备份客户端更新包。
- [x] 备份配置文件。
- [x] 备份文件名包含日期。
- [x] 备份完成输出校验摘要。
- [x] 备份失败返回非零退出码。
- [x] 支持默认保留最近 7 次或可配置保留策略。

## 12. 恢复脚本任务

- [x] 创建 `scripts/restore.sh`。
- [x] 恢复前提示会覆盖当前数据。
- [x] 恢复前检查备份完整性。
- [x] 恢复 PostgreSQL 数据。（2026-05-25 将真实 dump 恢复到一次性库 `enterprise_agent_hub_g005_restore`；恢复后 `users=2`、`extensions=1`）
- [x] 恢复包文件。（2026-05-25 使用 fixture 哨兵文件验证 `client-updates`、`manifests`、`plugin-packages`、`install-manifests` 均恢复到目标目录）
- [x] 恢复配置文件。（2026-05-25 使用 fixture `config/server.env` 哨兵文件验证恢复到目标目录）
- [x] 恢复后执行 Flyway 状态检查。（2026-05-25 `FLYWAY_CHECK_CMD` 查询恢复库 `flyway_schema_history` 成功记录数为 8）
- [x] 恢复后检查包文件存在性。
- [x] 恢复失败输出明确失败位置。
- [x] 恢复完成后健康检查通过。

## 13. 离线部署包任务

- [x] 创建离线部署目录结构。
- [x] 包含 `docker-compose.yml`。
- [ ] 包含 `images/api.tar`。（真实离线镜像包延期，未创建假 tar）
- [ ] 包含 `images/web-admin.tar`，如已有 Web 管理端静态资源镜像。（Web Admin 静态前端已完成；真实镜像 tar 待部署门禁生成，未创建假 tar）
- [x] 包含 `images/postgres.tar` 或企业可接受的数据库镜像说明。
- [x] 包含 `config/.env.example`。
- [x] 包含 `config/storage.example.yml`。
- [x] 包含 `config/ai-precheck.example.yml`。
- [x] 包含 `scripts/load-images.sh`。
- [x] 包含 `scripts/install.sh`。
- [x] 包含 `scripts/backup.sh`。
- [x] 包含 `scripts/restore.sh`。
- [x] 包含 `scripts/healthcheck.sh`。
- [x] 包含部署 README。
- [ ] 运行时不访问互联网。（2026-05-25 可观察检查显示本机服务进程仅监听 `*:18080` 并连接 `127.0.0.1:5432`；未执行隔离网络/air-gapped smoke，保持未完成）

## 14. 审计查询与排障任务

- [x] 审计日志支持按 requestID 查询。
- [x] 审计日志支持按用户查询。
- [x] 审计日志支持按对象类型和对象 ID 查询。
- [x] 审计日志支持按动作和时间范围查询。
- [x] 审计日志按管理员管理范围过滤。
- [x] 审计日志可导出 CSV，且导出动作写审计。
- [x] 审计详情可跳转或关联用户、扩展、申请、设备、更新记录。（2026-05-25 `web-admin` 审计页已实现列表 + 详情分栏，并按对象类型关联跳转部门用户、扩展、审核、设备、更新页面；静态测试/构建通过）
- [x] 运行日志和审计日志 requestID 可关联。
- [x] 本地事件和设备事件可关联。

## 15. 端到端验收任务

- [ ] 服务端 Docker Compose 启动。（本轮未重跑服务端镜像部署）
- [x] 管理员登录。
- [x] 创建部门和用户。
- [x] 普通用户登录桌面客户端。
- [x] 用户提交 Skill 发布申请。
- [x] 规则预审和 AI 预审生成结果。
- [x] 管理员审核通过。
- [x] 社区可搜索 Skill。
- [x] 授权用户安装 Skill。
- [x] Skill 启用到工具或项目 dry-run 或测试目录。
- [x] 用户提交 MCP 发布申请。
- [x] 管理员审核通过。
- [x] 授权用户写入 MCP 配置 dry-run 或测试配置。
- [x] 用户提交 Plugin 发布申请。
- [x] managed-package 或 config-plugin 跑通测试目录安装。
- [x] manual-download 跑通受控下载和标记已安装。
- [x] 授权收缩后禁止新增主操作。
- [x] 授权收缩后允许停用和卸载。
- [x] 展示收缩后未授权用户不可搜索。
- [x] 下架后不可新增安装。
- [x] 安全下架后本地显示风险或执行策略。
- [x] 审计日志可查上述关键操作。
- [x] 客户端设备可登记和心跳。
- [x] 客户端更新检查、下载校验、事件上报可用。
- [x] 备份脚本可执行。
- [x] 恢复脚本真实执行并健康检查通过。（2026-05-25 `scripts/restore.sh --force` 执行 checksum、真实 `pg_restore`、文件覆盖恢复、Flyway 检查和恢复健康检查通过）

## 16. 性能与安全验收任务

- [x] 社区首页 2 秒内返回主要数据。（2026-05-25 本机真实服务端 `14.6ms <= 2000ms`，requestId `req_7gf2tw5w3v3xqz7qdtfh5pjjay`）
- [x] 搜索结果第一页 2 秒内返回。（2026-05-25 本机真实服务端 `9.7ms <= 2000ms`，requestId `req_e8nzyxas5cehbx6mafqwy3r7a3`）
- [x] 扩展详情 1 秒内返回基础信息。（2026-05-25 本机真实服务端 `6.1ms <= 1000ms`，requestId `req_m4tdr247znjfyph7wnkjnecgr4`）
- [x] 审核列表 2 秒内返回第一页。（2026-05-25 本机真实服务端 `6.3ms <= 2000ms`，requestId `req_gp1kmpqry2dec0882dzb6tqkzd`）
- [x] 审计日志查询 3 秒内返回第一页。（2026-05-25 本机真实服务端 `7.5ms <= 3000ms`，requestId `req_mrhp91cbagdpn4j0ycwp61f1c8`）
- [x] 客户端设备列表 3 秒内返回第一页。（2026-05-25 本机真实服务端 `7.6ms <= 3000ms`，requestId `req_deawn2z4bkfv4a7tp35xv5zdg4`）
- [x] 上传包校验路径穿越、绝对路径、解压逃逸。
- [x] 客户端更新包校验 Hash 和签名。
- [x] 密码、Token、API Key、下载凭证不进入日志。
- [x] MCP 敏感变量不保存服务端。
- [x] AI 预审输入脱敏。
- [ ] 运行时不访问互联网。（2026-05-25 可观察检查显示本机服务进程只连接本机 PostgreSQL；未执行隔离网络/air-gapped smoke，保持未完成）

## 17. 测试任务

- [x] 服务端单元测试全部通过。
- [x] 服务端集成测试全部通过。
- [x] 客户端单元测试全部通过。
- [x] 客户端 IPC 测试通过。
- [x] 客户端本地执行测试通过。
- [x] 端到端测试通过。
- [ ] Docker Compose 测试通过。（PostgreSQL Compose 参与测试；服务端镜像 Compose 未重跑）
- [x] 备份恢复测试通过（2026-05-25 真实 `pg_dump`/`pg_restore` + checksum fixture + Flyway/healthcheck 通过）。
- [ ] 离线部署包导入测试通过。（真实 image tar 导入延期）
- [x] 安全测试通过。

## 18. 阶段验收

- [x] 客户端设备登记、心跳、版本分布可用。（2026-05-25 已补版本分布聚合 API 与桌面心跳调度测试；独立 Web Admin 展示待后续阶段）
- [x] 客户端更新发布、检查、下载、Hash 和签名校验可用。（已补 platform 过滤、语义版本比较、本机签名 fail-closed；真实 Windows 签名包验证未执行）
- [x] Settings 乐观锁可用。
- [x] 备份和恢复脚本可执行。（2026-05-25 真实备份/恢复演练通过；恢复库 `flyway_schema_history` 成功记录数为 8）
- [ ] 离线部署包可用。（目录/scripts/README dry-run 通过；真实镜像导入延期）
- [x] 审计查询和 requestID 排障链路完整。
- [x] 三类扩展端到端闭环通过。
- [x] 授权范围、可见选项、下架、安全下架规则通过。
- [x] 性能和安全验收通过。（2026-05-25 六个指定服务端端点真实计时均低于阈值；安全测试历史通过）
- [x] 所有阶段子清单已更新。（2026-05-11 review 修复同步校正，未验证门禁保持未勾选）
- [ ] 总清单所有阶段完成。（M8 最终发布门禁保留）

## 19. 阶段完成记录

```text
完成时间：2026-05-08 22:31:30 CST（首轮验证）
分支：main（当前工作树；计划分支 feature/m8-device-update-backup-deploy-acceptance）
提交 Commit：未提交（当前工作树）；基线 5ffc916
完成项数量：167/178（2026-05-25 部署恢复性能门禁后校正）
未完成项数量：11（主要为真实 Windows 签名包、Web Admin 离线镜像/服务端托管、真实离线镜像导入、Docker Compose 服务部署、air-gapped/no-internet 隔离验证、真实内网桌面 E2E）
验证命令（2026-05-08 首轮历史）：Docker Maven `mvn -f server/pom.xml test`（clean DB enterprise_agent_hub_test_m8_final_latest）；`npm --prefix desktop run typecheck`；`npm --prefix desktop test`；`npm --prefix desktop run lint`；`npm --prefix desktop run build`；`npm --prefix desktop run test:electron`；`bash -n scripts/backup.sh scripts/restore.sh deploy/offline/enterprise-agent-hub-server/scripts/*.sh`；`bash scripts/backup.sh --dry-run --output-dir /tmp/eah-backups --retention 7`；fixture `scripts/restore.sh --dry-run`；`deploy/offline/.../load-images.sh --dry-run`；`deploy/offline/.../install.sh --dry-run --skip-load-images`；`git diff --check`；JSON manifest 校验；Ralph architect 复审。
验证结果（2026-05-08 首轮历史）：服务端 56 tests / 0 failures / 0 errors；桌面 19 files / 42 tests + electron smoke 1 file / 2 tests 通过；lint/build/typecheck 通过；备份/恢复/离线脚本 dry-run 通过；架构复审 APPROVED。2026-05-11 review 修复后 Docker Maven 服务端 58 tests、桌面 19 files / 44 tests、lint/build/typecheck、Electron smoke、脚本语法、静态校验均通过；未真实演练的发布门禁保持未勾选。
遗留问题：不创建假离线镜像 tar；真实 Windows x64 installer/signing、Web Admin 离线镜像/服务端托管、air-gapped image import smoke、Docker Compose 服务部署、运行时无互联网隔离验证和真实内网桌面 E2E 保留为后续门禁。
是否更新总清单：是；总清单标记 M8 首轮已验证但不勾选最终完成。
```

```text
复核时间：2026-05-11 23:42:26 CST（code review 修复）
修复内容：客户端更新签名默认改为 Windows Authenticode 本机校验并 fail closed；默认安装器启动器改为 Windows launcher；服务端更新检查补 platform 过滤与语义版本比较；设备注册阻止跨用户 device_id 抢占；管理查询改为 SQL 过滤分页；设置 key 改为允许列表；restore.sh 对称恢复更新包/manifest/plugin/install 目录；总清单撤回未验证门禁勾选。
验证命令：Docker Maven `mvn -q -f server/pom.xml test`（临时库 `enterprise_agent_hub_test_review_20260511_2344`）；`npm --prefix desktop run typecheck`；`npm --prefix desktop test`；`npm --prefix desktop run lint`；`npm --prefix desktop run build`；`npm --prefix desktop run test:electron`；`bash -n scripts/backup.sh scripts/restore.sh deploy/offline/enterprise-agent-hub-server/scripts/backup.sh deploy/offline/enterprise-agent-hub-server/scripts/healthcheck.sh deploy/offline/enterprise-agent-hub-server/scripts/install.sh deploy/offline/enterprise-agent-hub-server/scripts/load-images.sh deploy/offline/enterprise-agent-hub-server/scripts/restore.sh`；最小备份 fixture `scripts/restore.sh --dry-run --force`；`git diff --check`；JSON manifest 校验。
验证结果：服务端 20 suites / 58 tests / 0 failures / 0 errors；桌面 typecheck 通过；Vitest 19 files / 44 tests 通过；lint/build/Electron smoke 通过；脚本语法检查通过；restore fixture dry-run 识别并恢复 client-updates/package-manifests/plugin-packages/install-manifests 路径；`git diff --check`、JSON manifest 校验通过。
未验证：真实 Windows 签名包、真实安装器启动、真实 pg_restore/文件覆盖恢复、air-gapped image import、性能计时仍未完成。
```

```text
复核时间：2026-05-25 CST（桌面 Renderer 前端联通）
修复内容：桌面客户端 Renderer 从 smoke screen 替换为真实 React 客户端；顶层导航固定为 Agent / 社区 / 本地；接入登录/会话、社区首页、搜索、详情、版本、Star、Skill/MCP/Plugin 本地动作、本地清理、发布向导、我的提交、通知、设置、修改密码、客户端更新；补齐必要 preload/IPC/API client 桥接并保留 Renderer 不直接访问 Node/fs/token/服务端 HTTP 的边界。
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron
验证结果：desktop typecheck 通过；Vitest 20 files / 51 tests 通过；desktop lint 通过；Vite/Electron main build 通过；Electron runtime isolation smoke 与 electron-smoke 1 file / 2 tests 通过。
未验证：未连接真实服务端执行登录、搜索、详情、安装/接入、发布申请、我的提交、更新全链路 E2E；未执行真实 Windows 签名包/安装器；未做性能计时、air-gapped image import、真实备份恢复/Compose 部署演练。Web 管理端前端按本阶段边界明确搁置。
```

```text
复核时间：2026-05-25 CST（M8 设备与更新补强）
修复内容：桌面 Main 增加定时心跳调度器；心跳上报本地待同步事件数量；deviceID 保持稳定但客户端版本随当前构建刷新；客户端更新增加启动版本状态文件与 UPDATED_FIRST_START 上报；服务端新增客户端版本分布聚合 API；客户端更新事件批量上报覆盖更新后首次启动事件。
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test -- --run tests/device-heartbeat-scheduler.test.ts tests/client-update-service.test.ts tests/app-paths.test.ts tests/api-client.test.ts；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron；临时 Maven + OpenJDK 21 `mvn -q -f server/pom.xml -Dtest=ClientDeviceApiTests,ClientUpdateApiTests test`；临时 Maven + OpenJDK 21 `mvn -q -f server/pom.xml test`
验证结果：desktop typecheck 通过；新增/相关 Vitest 4 files / 19 tests 通过；desktop 全量 Vitest 21 files / 60 tests 通过；desktop lint/build/test:electron 通过；服务端目标测试通过；服务端全量 Maven 测试通过。
未验证：真实 Windows 签名包更新后首次启动 E2E、真实 Windows 安装器启动、独立 Web Admin 页面展示、air-gapped image import、真实性能计时、真实备份恢复/Compose 部署演练仍未完成。
```

```text
复核时间：2026-05-25 CST（独立 Web Admin 静态前端）
修复内容：新增独立 `web-admin` React/Vite 管理端，不进入桌面客户端导航；覆盖管理端登录、概览、审核列表/详情/决策、扩展管理/详情/治理、部门树、用户列表/创建/冻结/解冻/重置、审计日志/详情/CSV 导出/关联跳转、客户端设备/版本分布/设备详情、客户端更新版本/事件/创建/状态流转、系统设置查看/保存；所有数据入口走服务端真实 API envelope，空态/错误态/requestId/权限态由前端展示。
验证命令：npm --prefix web-admin install；npm --prefix web-admin run typecheck；npm --prefix web-admin test；npm --prefix web-admin run lint；npm --prefix web-admin run build；npm --prefix web-admin run preview -- --port 4173；curl -sS http://127.0.0.1:4173/
验证结果：`web-admin` install 成功且 0 vulnerabilities；typecheck 通过；Vitest 2 files / 7 tests 通过；lint 通过；Vite build 输出 `dist/index.html` 与 assets；preview 端口 4173 可返回引用构建产物的 HTML。
未验证：未把 Web Admin 打入 `images/web-admin.tar` 或服务端静态资源目录；未执行真实内网部署、air-gapped import、真实管理员账号端到端操作。
```

```text
复核时间：2026-05-25 CST（部署、备份恢复、性能门禁）
修复内容：使用一次性本地 PostgreSQL 17.9 库启动真实 Spring Boot 服务，验证 `/actuator/health`；使用真实登录 token 对社区首页、搜索、扩展详情、审核列表、审计日志、客户端设备列表完成阈值计时；使用 fixture 文件与一次性恢复库执行真实 `pg_dump`/`pg_restore`、checksum、文件覆盖恢复、Flyway 状态检查和恢复健康检查；执行离线部署脚本语法与 dry-run；记录 Docker daemon 不可用和无真实 image tar 的外部门禁。
验证命令：`curl http://127.0.0.1:18080/actuator/health`；Node fetch 计时脚本（`/api/extensions/community/home`、`/api/extensions/search`、`/api/extensions/g005-skill`、`/api/reviews/tasks`、`/api/admin/audit-logs`、`/api/admin/client-devices`）；`scripts/backup.sh --output-dir <tmp>`；`scripts/restore.sh --backup-dir <tmp> --force`；`bash -n scripts/backup.sh scripts/restore.sh scripts/healthcheck.sh deploy/offline/enterprise-agent-hub-server/scripts/*.sh`；`deploy/offline/.../load-images.sh --dry-run`；`deploy/offline/.../install.sh --dry-run`；`deploy/offline/.../install.sh --dry-run --skip-load-images`；`SERVER_PORT=18080 bash scripts/healthcheck.sh`；`docker compose version && docker compose -f docker-compose.yml ps`；`lsof -nP -a -p <server-pid> -iTCP`。
验证结果：服务端健康 `UP`；性能计时分别为 14.6ms、9.7ms、6.1ms、6.3ms、7.5ms、7.6ms，均低于阈值；备份恢复 checksum 全部 OK，恢复库 `users=2`、`extensions=1`、`flyway_schema_history success=8`，哨兵文件恢复成功；离线脚本 dry-run 在缺少真实 image tar 时明确提示延期但返回成功；Docker Compose v5.1.0 存在但 Docker daemon 不可连接，服务端镜像 Compose 部署未执行。
未验证：真实 Windows 签名包、Web Admin 离线镜像/服务端托管、真实 image tar 导入、air-gapped/no-internet 隔离网络 smoke、真实企业内网桌面端到端联调。
```

```text
复核时间：2026-05-25 CST（最终验收与质量门）
修复内容：修复服务端 LocalEventsSyncApiTests 固定幂等键导致重复运行被历史数据污染的问题；确认桌面登录弹窗关闭按钮由渲染测试覆盖；补充 `.gitignore` 排除 Web Admin 依赖和构建产物；执行 changed-file slop scan 与最终 code review，未发现剩余 P0/P1/P2 阻断项。
验证命令：`npm --prefix desktop run typecheck && npm --prefix desktop test && npm --prefix desktop run lint && npm --prefix desktop run build && npm --prefix desktop run test:electron`；`npm --prefix web-admin run typecheck && npm --prefix web-admin test && npm --prefix web-admin run lint && npm --prefix web-admin run build`；`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home /tmp/apache-maven-3.9.9/bin/mvn -q -f server/pom.xml test`；`bash -n scripts/backup.sh scripts/restore.sh scripts/healthcheck.sh deploy/offline/enterprise-agent-hub-server/scripts/*.sh && git diff --check && python3 -m json.tool docs/DetailedDesign/MANIFEST.json >/dev/null && python3 -m json.tool docs/DevelopmentTasks/MANIFEST.json >/dev/null`。
验证结果：desktop typecheck 通过、Vitest 21 files / 60 tests 通过、lint/build/test:electron 1 file / 3 tests 通过；web-admin typecheck 通过、Vitest 2 files / 7 tests 通过、lint/build 通过；服务端 Maven 20 suites / 58 tests / 0 failures / 0 errors / 0 skipped；脚本语法、diff whitespace 和 JSON manifest 校验通过。
未验证：真实 Windows 签名包、Web Admin 离线镜像/服务端托管、真实 image tar 导入、air-gapped/no-internet 隔离网络 smoke、真实企业内网桌面端到端联调仍保留为外部门禁。
```
