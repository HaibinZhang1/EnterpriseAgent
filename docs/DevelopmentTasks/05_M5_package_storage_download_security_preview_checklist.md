# 05. M5 包存储、下载凭证、安全校验与文件预览清单

## 1. 阶段目标

实现服务端文件存储、包上传、包安全校验、Hash 校验、MCP/Plugin 清单保存、文件预览、短期下载凭证和下载事件，为 Skill、MCP Server、Plugin 的发布审核和安装下载提供可落地基础。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M5 |
| 名称 | 包存储、下载凭证、安全校验与文件预览 |
| 状态 | 未开始 |
| 完成率 | 0% |
| 分支 | feature/m5-package-storage-download-security-preview |
| 开始时间 | 待填写 |
| 完成时间 | 待填写 |
| 提交 Commit | 待填写 |
| 负责人 / Agent | 待填写 |
| 验收结论 | 待验收 |

## 3. 前置条件

- [ ] M1 已完成。
- [ ] M2 已完成。
- [ ] M3 已完成。
- [ ] M4 已完成。
- [ ] Submission、Precheck、Review 可引用包快照。
- [ ] Extension、Version 可保存 package_hash、package_path。

## 4. 输入文档

- [ ] 阅读 `docs/RequirementDocument/17_package_specs.md`。
- [ ] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 安全与存储要求。
- [ ] 阅读 `docs/RequirementDocument/23_technical_architecture.md` 文件存储规范。
- [ ] 阅读 `docs/DetailedDesign/11_AI预审_安全扫描_审计设计.md`。
- [ ] 阅读 `docs/DetailedDesign/12_文件存储_下载凭证_预览设计.md`。
- [ ] 阅读 `docs/DetailedDesign/14_异常处理_错误码_幂等.md`。

## 5. 数据库迁移任务

- [ ] 创建 `V5__package_storage_download_preview.sql`。
- [ ] 创建 `package_objects` 或等价包对象表。
- [ ] 保存 object_type、object_id、extension_id、version、package_hash、package_path、size、file_count。
- [ ] 创建 `package_files` 或等价文件清单表。
- [ ] 保存相对路径、大小、hash、mime/type、risk_flags、previewable。
- [ ] 创建 `download_tickets` 表。
- [ ] download_tickets 保存 object_type、object_id、user_id、device_id、expires_at、used_at、status。
- [ ] 创建 `download_events` 或使用 activity_events 记录下载事件。
- [ ] 创建 preview metadata 表或明确 preview 文件路径策略。
- [ ] 创建必要索引：hash、extension_id/version、ticket status、expires_at。

## 6. 存储目录任务

- [ ] 创建服务端存储根目录配置。
- [ ] 创建 `/storage/packages/skill`。
- [ ] 创建 `/storage/packages/mcp`。
- [ ] 创建 `/storage/packages/plugin`。
- [ ] 创建 `/storage/manifests/mcp`。
- [ ] 创建 `/storage/manifests/plugin`。
- [ ] 创建 `/storage/client-updates`。
- [ ] 创建 `/storage/previews`。
- [ ] 创建 `/storage/temp`。
- [ ] 创建 `/storage/backups`。
- [ ] 上传先进入 temp，校验通过后移动正式目录。
- [ ] 正式包不得静默覆盖。
- [ ] 路径包含类型、Extension ID、版本和 Hash。

## 7. 包上传任务

- [ ] 创建 PackageStorageService。
- [ ] 创建 PackageUploadService。
- [ ] 支持 Skill zip 上传。
- [ ] 支持 MCP 定义清单上传或粘贴保存。
- [ ] 支持 Plugin 包、安装清单、手动安装说明保存。
- [ ] 计算 SHA-256。
- [ ] 校验上传大小。
- [ ] 校验解压后大小。
- [ ] 校验文件数量。
- [ ] 校验单文件大小。
- [ ] 上传失败清理 temp 文件。
- [ ] 包存储失败不得创建已发布版本。
- [ ] 同一版本包 Hash 一旦登记，不得静默替换。

## 8. 安全校验任务

- [ ] 创建 SafeZipExtractor。
- [ ] 禁止 `../` 路径穿越。
- [ ] 禁止绝对路径。
- [ ] 禁止 Windows 盘符绝对路径。
- [ ] 禁止解压后文件逃逸目标目录。
- [ ] 禁止 zip 内软链接指向包外路径。
- [ ] 禁止空文件名、控制字符、系统保留名称。
- [ ] 检测压缩炸弹风险。
- [ ] 检测可执行文件风险。
- [ ] 检测脚本文件风险。
- [ ] 检测二进制文件风险。
- [ ] 检测证书、私钥、Token 样式内容风险。
- [ ] 检测外部网络地址风险。
- [ ] 风险项进入审核详情，不一定全部拒绝。
- [ ] 路径穿越、绝对路径、解压逃逸必须拒绝。

## 9. Skill 包任务

- [ ] 校验根目录必须包含 `SKILL.md`。
- [ ] 推荐识别 `README.md`、`CHANGELOG.md`、icon、examples、resources。
- [ ] 校验包大小不超过配置限制。
- [ ] 校验文件数不超过配置限制。
- [ ] 解析 YAML frontmatter，如存在。
- [ ] 生成 README 摘要或预览引用。
- [ ] 保存文件清单和风险摘要。

## 10. MCP 定义任务

- [ ] 校验 serverName、version、accessType、transport。
- [ ] 校验 command 或 endpoint 必填规则。
- [ ] 校验 remote-http/streamable-http。
- [ ] 校验 remote-sse/sse。
- [ ] 校验 local-command/stdio。
- [ ] `http` 兼容输入规范化为 `streamable-http`。
- [ ] 校验 variables schema。
- [ ] 校验 configTemplate 可渲染性。
- [ ] 校验 connectionTest。
- [ ] env 示例不得包含真实密钥。
- [ ] local-command 高风险执行器或下载后执行语义标记风险。
- [ ] 保存 MCP 定义版本快照。

## 11. Plugin 包与清单任务

- [ ] 校验 pluginName、version、targetTools、installMode、compatibleVersions。
- [ ] managed-package 必须有插件包、SHA-256、文件清单、安装清单、更新、卸载、回滚说明。
- [ ] config-plugin 必须有配置清单、目标配置路径规则、启用、禁用、卸载、回滚说明。
- [ ] manual-download 必须有手动安装说明、手动卸载说明、受控下载文件或企业内部下载地址。
- [ ] 企业内部下载地址必须登记 SHA-256、文件大小、来源系统、有效期。
- [ ] 保存 Plugin 安装清单版本快照。

## 12. 文件预览任务

- [ ] 支持 `.md`、`.markdown`、`.txt`、`.json`、`.yaml`、`.yml` 预览。
- [ ] 图片仅生成缩略图或保存预览元数据。
- [ ] 二进制文件不可预览。
- [ ] 大文件预览超过 256 KB 截断。
- [ ] 预览不得执行脚本。
- [ ] 预览不得自动打开未知二进制。
- [ ] 审核详情可查询文件清单和预览内容。
- [ ] 预览内容脱敏敏感明文。

## 13. 下载凭证任务

- [ ] 创建 DownloadTicketService。
- [ ] 下载凭证短期有效。
- [ ] 下载凭证绑定用户和对象。
- [ ] 下载凭证可绑定 deviceID。
- [ ] 下载凭证只保存 hash，不保存明文。
- [ ] 使用后标记 used_at 或支持多次短时访问策略。
- [ ] 过期凭证返回 `download_ticket_expired` 或等价错误。
- [ ] 下载前服务端重新校验身份、扩展状态、版本状态、授权范围、可见选项。
- [ ] 已下架、已安全下架、已归档不可发放新下载凭证。
- [ ] 下载事件写 activity_events 或 download_events。
- [ ] 下载凭证明文不得写日志或审计。

## 14. API 任务

- [ ] `POST /api/packages/upload` 上传包。
- [ ] `GET /api/packages/{packageId}/files` 文件清单。
- [ ] `GET /api/packages/{packageId}/preview?path=` 文件预览。
- [ ] `POST /api/download-tickets` 申请下载凭证。
- [ ] `GET /api/download-tickets/{ticket}/download` 下载文件。
- [ ] `GET /api/admin/packages/{packageId}/risk-summary` 审核风险摘要。
- [ ] 所有上传和下载接口有 requestID。
- [ ] 上传和下载失败使用稳定错误码。

## 15. 审计与统计任务

- [ ] 上传包写审计。
- [ ] 包校验失败写审计或预审结果。
- [ ] 下载凭证发放写审计或统计事件。
- [ ] 下载事件进入统计，更新下载量口径。
- [ ] 审核下载不计入扩展下载量。
- [ ] 文件预览不计入下载量。
- [ ] 敏感内容不写入审计明文。

## 16. 测试任务

- [ ] 正常 Skill 包上传测试。
- [ ] 缺少 `SKILL.md` 拒绝测试。
- [ ] 路径穿越 zip 拒绝测试。
- [ ] 绝对路径拒绝测试。
- [ ] 解压逃逸拒绝测试。
- [ ] 压缩炸弹风险测试。
- [ ] 可执行文件风险提示测试。
- [ ] 疑似密钥风险提示测试。
- [ ] MCP transport 合法组合测试。
- [ ] MCP env 真实密钥警告测试。
- [ ] Plugin manifest 完整性测试。
- [ ] 预览截断测试。
- [ ] 下载凭证过期测试。
- [ ] 未授权用户下载拒绝测试。
- [ ] 下架扩展下载拒绝测试。
- [ ] 下载事件统计测试。
- [ ] `mvn -f server/pom.xml test` 通过。

## 17. 阶段验收

- [ ] 包上传、存储、Hash、文件清单可用。
- [ ] Skill/MCP/Plugin 类型化校验可用。
- [ ] 路径穿越、绝对路径、解压逃逸必须拒绝。
- [ ] 脚本、可执行文件、疑似密钥进入风险提示。
- [ ] 文件预览安全可控。
- [ ] 下载凭证短期有效并重新校验授权。
- [ ] 下载事件接入统计。
- [ ] 敏感明文不进入日志或审计。
- [ ] 所有测试通过。

## 18. 阶段完成记录

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
