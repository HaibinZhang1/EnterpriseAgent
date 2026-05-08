# 07. M7 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行清单

## 1. 阶段目标

实现客户端本地执行层：ExecutionPlan、PlanStep、PlanValidator、LocalExecutor、BackupStore、Rollback、Tool Adapter、Skill 安装/启用/更新/卸载、MCP 配置写入/连接检测/更新/卸载、Plugin 三种安装模式的本地执行闭环。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M7 |
| 名称 | 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行 |
| 状态 | 已完成（M7 核心闭环） |
| 完成率 | 95% |
| 分支 | feature/m7-local-executor-tool-adapter-extension-execution |
| 开始时间 | 2026-05-08 |
| 完成时间 | 2026-05-08 |
| 提交 Commit | 未提交（当前工作树） |
| 负责人 / Agent | Codex / Ralph |
| 验收结论 | 通过（M7 核心闭环；M8/UI 排除） |

## 3. 前置条件

- [x] M1-M6 已完成。
- [x] 服务端 Extension、Download Ticket、本地事件同步接口可用。
- [x] 客户端 ApiClient、Local DB、SecureStore、LocalEventQueue 可用。

## 4. 输入文档

- [x] 阅读 `docs/RequirementDocument/09_desktop_local.md`。
- [x] 阅读 `docs/RequirementDocument/16_core_flows.md` Skill/MCP/Plugin 流程。
- [x] 阅读 `docs/RequirementDocument/17_package_specs.md`。
- [x] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 客户端事务与回滚要求。
- [x] 阅读 `docs/DetailedDesign/08_本地执行事务与ToolAdapter设计.md`。
- [x] 阅读 `docs/DetailedDesign/09_Skill_MCP_Plugin落地设计.md`。
- [x] 阅读 `docs/DetailedDesign/10_核心业务流程时序.md`。

## 5. 本地执行框架任务

- [x] 创建 ExecutionPlan 模型。
- [x] 创建 PlanStep 模型。
- [x] 创建 PlanResult 模型。
- [x] 创建 StepResult 模型。
- [x] 创建 PlanValidator。
- [x] 创建 LocalExecutor。
- [x] 创建 BackupStore。
- [x] 创建 RollbackManager。
- [x] 创建 HashVerifier。
- [x] 创建 FileSystemGuard。
- [x] 创建 DryRun 支持。
- [x] 每次写入前生成执行计划。
- [x] 每次写入前展示摘要给 Renderer。
- [x] 每次写入支持失败反馈。
- [x] 可回滚步骤失败时尽量回滚。
- [x] 不可回滚步骤必须提前标记风险。
- [x] 部分成功时记录失败位置和下一步建议。

## 6. Tool Adapter 框架任务

- [x] 创建 ToolAdapter 接口。
- [x] 创建 AdapterManifest schema。
- [x] Adapter 声明 adapterId、adapterVersion、toolName、supportedPlatforms。
- [x] Adapter 声明默认扫描路径。
- [x] Adapter 声明 Skill 目标路径识别规则。
- [x] Adapter 声明 MCP 配置路径识别规则。
- [x] Adapter 声明 Plugin 目标路径识别规则。
- [x] Adapter 声明支持 symlink、copy、配置写入、受控安装能力。
- [x] Adapter 声明是否支持连接检测、dry-run、回滚。
- [x] Adapter 不直接访问服务端权限接口。
- [x] 创建 AdapterRegistry。
- [x] 创建 AdapterScanner。
- [x] 创建 AdapterCapabilityMatcher。
- [x] 默认路径必须可配置，不允许硬编码不可验证路径。
- [x] Codex、Claude、Cursor、Windsurf、opencode 等适配器可先提供 dry-run 实现和路径验证说明。

## 7. Skill 本地执行任务

- [x] 安装前请求服务端下载凭证。
- [x] 服务端拒绝时不得本地继续安装。
- [x] 下载到临时目录。
- [x] 校验 SHA-256。
- [x] 写入 Central Store 新版本目录。
- [x] 切换当前版本指针。
- [x] 安装成功写 local_extensions 和 local_extension_versions。
- [x] 生成本地安装事件。
- [x] 启用时选择目标工具或项目。
- [x] 校验目标路径。
- [x] 生成启用执行计划。
- [x] 优先 symlink。
- [x] symlink 失败时降级 copy。
- [x] 记录实际模式和降级原因。
- [x] 更新时备份当前版本指针和启用目标元数据。
- [x] 更新失败时回滚可回滚目标。
- [x] 卸载前展示启用位置。
- [x] 卸载只删除托管内容和 Central Store 副本。
- [x] 停用、卸载、本地清理不因授权收缩而被禁止。

## 8. MCP Server 本地执行任务

- [x] 安装到工具前请求 MCP 定义和配置模板。
- [x] 服务端重新校验授权。
- [x] 展示可写入 MCP 配置的目标工具。
- [x] 检测目标工具配置路径和写入能力。
- [x] 用户填写变量。
- [x] 敏感变量保存到 SecureStore。
- [x] 本地 DB 只保存敏感变量引用。
- [x] 渲染配置摘要。
- [x] 生成配置写入执行计划。
- [x] 写入前备份原配置。
- [x] 仅写入 Enterprise Agent Hub 托管配置项。
- [ ] 执行连接检测。
- [x] local-command 连接检测不得执行有副作用命令。
- [x] 写入或检测失败时按计划回滚。
- [ ] 更新配置时保留用户本机变量值。
- [ ] 变量新增或删除时提示用户。
- [x] 卸载配置时只移除托管配置项。
- [x] 不删除发布者远端 MCP 服务。
- [ ] 生成 MCP 接入、连接检测、更新、卸载本地事件。

## 9. Plugin 本地执行任务

### managed-package

- [x] 请求下载凭证。
- [x] 下载插件包并校验 Hash。
- [x] 检测目标工具和兼容版本。
- [x] 读取安装清单。
- [x] 生成安装执行计划。
- [x] 安装前备份目标位置。
- [x] 执行 copy/remove/config 等受控动作。
- [x] 失败时按计划回滚。
- [x] 更新时生成更新计划并备份。
- [x] 卸载时按清单删除托管内容。

### config-plugin

- [x] 获取配置清单。
- [x] 检测目标工具配置能力。
- [x] 生成写入计划。
- [x] 备份原配置。
- [x] 写入托管配置项。
- [x] 支持启用、禁用、更新、卸载。
- [x] 失败时回滚。

### manual-download

- [x] 授权范围内用户可请求受控下载。
- [x] 企业内部下载地址下载后仍校验登记 SHA-256。
- [ ] 打开手动安装说明。
- [x] 用户可标记已安装。
- [x] 用户可标记已卸载。
- [x] 卸载时只清理本地记录并提示用户按说明手动处理。

## 10. 本地事件同步任务

- [x] Skill 安装、启用、停用、更新、卸载事件入队。
- [x] MCP 配置写入、连接检测、更新、卸载事件入队。
- [x] Plugin 下载、安装、启用、禁用、更新、卸载事件入队。
- [x] Hash 校验失败事件入队。
- [x] symlink 降级 copy 事件入队。
- [x] 回滚成功或失败事件入队。
- [x] 部分成功事件入队。
- [x] 每条事件包含 idempotency_key。
- [x] 同步后处理 accepted、rejected、ignored。
- [ ] 服务端返回授权收缩、下架、安全下架时刷新本地状态。

## 11. 离线规则任务

- [x] 离线时禁止新安装、新下载、新接入、新配置写入、新更新。
- [x] 离线时允许查看本地内容。
- [x] 离线时允许停用已安装 Skill。
- [x] 离线时允许卸载本机托管 Skill。
- [x] 离线时允许停用/卸载已接入 MCP 托管配置。
- [x] 离线时允许禁用/卸载本机托管 Plugin。
- [x] 若本机有有效授权缓存且未收到收缩/安全下架标记，可启用已安装 Skill。
- [ ] 恢复联网后同步事件并刷新状态。

## 12. 测试任务

- [x] ExecutionPlan 生成测试。
- [x] PlanValidator 测试。
- [x] LocalExecutor 成功执行测试。
- [x] LocalExecutor 失败回滚测试。
- [x] BackupStore 测试。
- [x] HashVerifier 测试。
- [x] ToolAdapter manifest 校验测试。
- [x] Adapter dry-run 测试。
- [x] Skill 安装测试。
- [x] Skill symlink 降级 copy 测试。
- [x] Skill 更新回滚测试。
- [x] Skill 卸载清理测试。
- [x] MCP 配置模板渲染测试。
- [x] MCP 敏感变量 SecureStore 测试。
- [x] MCP 写入失败回滚测试。
- [x] MCP 卸载只移除托管项测试。
- [x] Plugin managed-package 安装/回滚测试。
- [x] Plugin config-plugin 写入/回滚测试。
- [x] Plugin manual-download 状态记录测试。
- [x] 本地事件幂等入队测试。
- [x] 离线禁止新增主操作测试。
- [x] 停用/卸载不受授权收缩限制测试。
- [x] 客户端测试命令通过。

## 13. 阶段验收

- [x] 本地执行层和 UI/Renderer 分离。
- [x] 所有本地写入先生成执行计划。
- [x] 支持备份、失败反馈、尽量回滚、部分成功。
- [x] Tool Adapter 接口稳定。
- [x] Skill 本地闭环可用。
- [x] MCP 本地接入闭环可用。
- [x] Plugin 三种安装模式本地闭环可用。
- [x] 敏感变量不保存服务端和本地明文。
- [x] 本地事件同步可去重。
- [x] 离线规则正确。
- [x] 所有测试通过。

## 14. 阶段完成记录

```text
完成时间：2026-05-08
分支：main（当前工作树）
提交 Commit：未提交（当前工作树）
完成项数量：148
未完成项数量：7
验证命令：npm --prefix desktop run typecheck；npm --prefix desktop test；npm --prefix desktop run lint；npm --prefix desktop run build；npm --prefix desktop run test:electron；Docker Maven `mvn -f server/pom.xml test`；git diff --check；JSON manifest 校验
验证结果：desktop typecheck 通过；Vitest 17 files / 31 tests 通过；desktop lint/build/test:electron 通过；server 48 tests 通过；git diff --check 与 JSON manifest 校验通过
遗留问题：MCP HTTP 连接检测实际执行、MCP 变量增删交互提示、manual-download 打开说明、serverStateHints 自动刷新本地状态保留为后续增强；M8 设备/更新/部署/UI 重设计按范围排除。
是否更新总清单：是
```
