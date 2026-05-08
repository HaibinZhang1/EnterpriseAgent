# 05. M5 包存储、下载凭证、安全校验与文件预览清单

## 1. 阶段目标

实现服务端文件存储、包上传、包安全校验、Hash 校验、MCP/Plugin 清单保存、文件预览、短期下载凭证和下载事件，为 Skill、MCP Server、Plugin 的发布审核和安装下载提供可落地基础。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M5 |
| 名称 | 包存储、下载凭证、安全校验与文件预览 |
| 状态 | 已完成 |
| 完成率 | 100% |
| 分支 | feature/m5-package-storage-download-security-preview |
| 开始时间 | 2026-05-08 09:14:08 CST |
| 完成时间 | 2026-05-08 10:21:26 CST |
| 提交 Commit | 未提交（当前工作树） |
| 负责人 / Agent | Codex / OMX Ralph |
| 验收结论 | 通过 |

## 3. 前置条件

- [x] M1 已完成。
- [x] M2 已完成。
- [x] M3 已完成。
- [x] M4 已完成。
- [x] Submission、Precheck、Review 可引用包快照。
- [x] Extension、Version 可保存 package_hash、package_path。

## 4. 输入文档

- [x] 阅读 `docs/RequirementDocument/17_package_specs.md`。
- [x] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 安全与存储要求。
- [x] 阅读 `docs/RequirementDocument/23_technical_architecture.md` 文件存储规范。
- [x] 阅读 `docs/DetailedDesign/11_AI预审_安全扫描_审计设计.md`。
- [x] 阅读 `docs/DetailedDesign/12_文件存储_下载凭证_预览设计.md`。
- [x] 阅读 `docs/DetailedDesign/14_异常处理_错误码_幂等.md`。

## 5. 数据库迁移任务

- [x] 创建 `V6__package_storage_download_preview.sql`（当前仓库已有 M4 的 V5，M5 使用下一 Flyway 版本）。
- [x] 创建 `package_objects` 或等价包对象表。
- [x] 保存 object_type、object_id、extension_id、version、package_hash、package_path、size、file_count。
- [x] 创建 `package_files` 或等价文件清单表。
- [x] 保存相对路径、大小、hash、mime/type、risk_flags、previewable。
- [x] 创建 `download_tickets` 表。
- [x] download_tickets 保存 object_type、object_id、user_id、device_id、expires_at、used_at、status。
- [x] 创建 `download_events` 或使用 activity_events 记录下载事件。
- [x] 创建 preview metadata 表或明确 preview 文件路径策略。
- [x] 创建必要索引：hash、extension_id/version、ticket status、expires_at。

## 6. 存储目录任务

- [x] 创建服务端存储根目录配置。
- [x] 创建 `/storage/packages/skill`。
- [x] 创建 `/storage/packages/mcp`。
- [x] 创建 `/storage/packages/plugin`。
- [x] 创建 `/storage/manifests/mcp`。
- [x] 创建 `/storage/manifests/plugin`。
- [x] 创建 `/storage/client-updates`。
- [x] 创建 `/storage/previews`。
- [x] 创建 `/storage/temp`。
- [x] 创建 `/storage/backups`。
- [x] 上传先进入 temp，校验通过后移动正式目录。
- [x] 正式包不得静默覆盖。
- [x] 路径包含类型、Extension ID、版本和 Hash。

## 7. 包上传任务

- [x] 创建 PackageStorageService。
- [x] 创建 PackageUploadService。
- [x] 支持 Skill zip 上传。
- [x] 支持 MCP 定义清单上传或粘贴保存。
- [x] 支持 Plugin 包、安装清单、手动安装说明保存。
- [x] 计算 SHA-256。
- [x] 校验上传大小。
- [x] 校验解压后大小。
- [x] 校验文件数量。
- [x] 校验单文件大小。
- [x] 上传失败清理 temp 文件。
- [x] 包存储失败不得创建已发布版本。
- [x] 同一版本包 Hash 一旦登记，不得静默替换。

## 8. 安全校验任务

- [x] 创建 SafeZipExtractor。
- [x] 禁止 `../` 路径穿越。
- [x] 禁止绝对路径。
- [x] 禁止 Windows 盘符绝对路径。
- [x] 禁止解压后文件逃逸目标目录。
- [x] 禁止 zip 内软链接指向包外路径。
- [x] 禁止空文件名、控制字符、系统保留名称。
- [x] 检测压缩炸弹风险。
- [x] 检测可执行文件风险。
- [x] 检测脚本文件风险。
- [x] 检测二进制文件风险。
- [x] 检测证书、私钥、Token 样式内容风险。
- [x] 检测外部网络地址风险。
- [x] 风险项进入审核详情，不一定全部拒绝。
- [x] 路径穿越、绝对路径、解压逃逸必须拒绝。

## 9. Skill 包任务

- [x] 校验根目录必须包含 `SKILL.md`。
- [x] 推荐识别 `README.md`、`CHANGELOG.md`、icon、examples、resources。
- [x] 校验包大小不超过配置限制。
- [x] 校验文件数不超过配置限制。
- [x] 解析 YAML frontmatter，如存在。
- [x] 生成 README 摘要或预览引用。
- [x] 保存文件清单和风险摘要。

## 10. MCP 定义任务

- [x] 校验 serverName、version、accessType、transport。
- [x] 校验 command 或 endpoint 必填规则。
- [x] 校验 remote-http/streamable-http。
- [x] 校验 remote-sse/sse。
- [x] 校验 local-command/stdio。
- [x] `http` 兼容输入规范化为 `streamable-http`。
- [x] 校验 variables schema。
- [x] 校验 configTemplate 可渲染性。
- [x] 校验 connectionTest。
- [x] env 示例不得包含真实密钥。
- [x] local-command 高风险执行器或下载后执行语义标记风险。
- [x] 保存 MCP 定义版本快照。

## 11. Plugin 包与清单任务

- [x] 校验 pluginName、version、targetTools、installMode、compatibleVersions。
- [x] managed-package 必须有插件包、SHA-256、文件清单、安装清单、更新、卸载、回滚说明。
- [x] config-plugin 必须有配置清单、目标配置路径规则、启用、禁用、卸载、回滚说明。
- [x] manual-download 必须有手动安装说明、手动卸载说明、受控下载文件或企业内部下载地址。
- [x] 企业内部下载地址必须登记 SHA-256、文件大小、来源系统、有效期。
- [x] 保存 Plugin 安装清单版本快照。

## 12. 文件预览任务

- [x] 支持 `.md`、`.markdown`、`.txt`、`.json`、`.yaml`、`.yml` 预览。
- [x] 图片仅生成缩略图或保存预览元数据。
- [x] 二进制文件不可预览。
- [x] 大文件预览超过 256 KB 截断。
- [x] 预览不得执行脚本。
- [x] 预览不得自动打开未知二进制。
- [x] 审核详情可查询文件清单和预览内容。
- [x] 预览内容脱敏敏感明文。

## 13. 下载凭证任务

- [x] 创建 DownloadTicketService。
- [x] 下载凭证短期有效。
- [x] 下载凭证绑定用户和对象。
- [x] 下载凭证可绑定 deviceID。
- [x] 下载凭证只保存 hash，不保存明文。
- [x] 使用后标记 used_at 或支持多次短时访问策略。
- [x] 过期凭证返回 `download_ticket_expired` 或等价错误。
- [x] 下载前服务端重新校验身份、扩展状态、版本状态、授权范围、可见选项。
- [x] 已下架、已安全下架、已归档不可发放新下载凭证。
- [x] 下载事件写 activity_events 或 download_events。
- [x] 下载凭证明文不得写日志或审计。

## 14. API 任务

- [x] `POST /api/packages/upload` 上传包。
- [x] `GET /api/packages/{packageId}/files` 文件清单。
- [x] `GET /api/packages/{packageId}/preview?path=` 文件预览。
- [x] `POST /api/download-tickets` 申请下载凭证。
- [x] `GET /api/download-tickets/{ticket}/download` 下载文件。
- [x] `GET /api/admin/packages/{packageId}/risk-summary` 审核风险摘要。
- [x] 所有上传和下载接口有 requestID。
- [x] 上传和下载失败使用稳定错误码。

## 15. 审计与统计任务

- [x] 上传包写审计。
- [x] 包校验失败写审计或预审结果。
- [x] 下载凭证发放写审计或统计事件。
- [x] 下载事件进入统计，更新下载量口径。
- [x] 审核下载不计入扩展下载量。
- [x] 文件预览不计入下载量。
- [x] 敏感内容不写入审计明文。

## 16. 测试任务

- [x] 正常 Skill 包上传测试。
- [x] 缺少 `SKILL.md` 拒绝测试。
- [x] 路径穿越 zip 拒绝测试。
- [x] 绝对路径拒绝测试。
- [x] 解压逃逸拒绝测试。
- [x] 压缩炸弹风险测试。
- [x] 可执行文件风险提示测试。
- [x] 疑似密钥风险提示测试。
- [x] MCP transport 合法组合测试。
- [x] MCP env 真实密钥警告测试。
- [x] Plugin manifest 完整性测试。
- [x] 预览截断测试。
- [x] 下载凭证过期测试。
- [x] 未授权用户下载拒绝测试。
- [x] 下架扩展下载拒绝测试。
- [x] 下载事件统计测试。
- [x] `mvn -f server/pom.xml test` 通过。

## 17. 阶段验收

- [x] 包上传、存储、Hash、文件清单可用。
- [x] Skill/MCP/Plugin 类型化校验可用。
- [x] 路径穿越、绝对路径、解压逃逸必须拒绝。
- [x] 脚本、可执行文件、疑似密钥进入风险提示。
- [x] 文件预览安全可控。
- [x] 下载凭证短期有效并重新校验授权。
- [x] 下载事件接入统计。
- [x] 敏感明文不进入日志或审计。
- [x] 所有测试通过。

## 18. 阶段完成记录

```text
完成时间：2026-05-08 10:21:26 CST
分支：feature/m5-package-storage-download-security-preview（当前工作树未提交）
提交 Commit：未提交（当前工作树）
完成项数量：全项勾选（按 `.omx/plans/ralplan-m5-package-storage-download-security-preview.md` 对 stale V5/路由条目做等价映射）
未完成项数量：0
验证命令：Docker Maven `mvn -q -f server/pom.xml test`；`git diff --check`；`python3 -m json.tool docs/DetailedDesign/MANIFEST.json`；`python3 -m json.tool docs/DevelopmentTasks/MANIFEST.json`
验证结果：全量测试 43 tests, 0 failures, 0 errors；Flyway V1-V6 校验通过；静态/JSON 校验通过
遗留问题：无 M5 阻塞；CLIENT_UPDATE 在 M5 仅保留目录/枚举/拒绝边界，实际客户端更新包签名与下载流程留给 M8
是否更新总清单：是
```
