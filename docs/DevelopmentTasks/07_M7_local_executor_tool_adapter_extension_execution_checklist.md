# 07. M7 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行清单

## 1. 阶段目标

实现客户端本地执行层：ExecutionPlan、PlanStep、PlanValidator、LocalExecutor、BackupStore、Rollback、Tool Adapter、Skill 安装/启用/更新/卸载、MCP 配置写入/连接检测/更新/卸载、Plugin 三种安装模式的本地执行闭环。

## 2. 阶段状态

| 字段 | 当前值 |
|---|---|
| 阶段 | M7 |
| 名称 | 本地执行器、Tool Adapter、Skill/MCP/Plugin 本地执行 |
| 状态 | 未开始 |
| 完成率 | 0% |
| 分支 | feature/m7-local-executor-tool-adapter-extension-execution |
| 开始时间 | 待填写 |
| 完成时间 | 待填写 |
| 提交 Commit | 待填写 |
| 负责人 / Agent | 待填写 |
| 验收结论 | 待验收 |

## 3. 前置条件

- [ ] M1-M6 已完成。
- [ ] 服务端 Extension、Download Ticket、本地事件同步接口可用。
- [ ] 客户端 ApiClient、Local DB、SecureStore、LocalEventQueue 可用。

## 4. 输入文档

- [ ] 阅读 `docs/RequirementDocument/09_desktop_local.md`。
- [ ] 阅读 `docs/RequirementDocument/16_core_flows.md` Skill/MCP/Plugin 流程。
- [ ] 阅读 `docs/RequirementDocument/17_package_specs.md`。
- [ ] 阅读 `docs/RequirementDocument/20_non_functional_deployment.md` 客户端事务与回滚要求。
- [ ] 阅读 `docs/DetailedDesign/08_本地执行事务与ToolAdapter设计.md`。
- [ ] 阅读 `docs/DetailedDesign/09_Skill_MCP_Plugin落地设计.md`。
- [ ] 阅读 `docs/DetailedDesign/10_核心业务流程时序.md`。

## 5. 本地执行框架任务

- [ ] 创建 ExecutionPlan 模型。
- [ ] 创建 PlanStep 模型。
- [ ] 创建 PlanResult 模型。
- [ ] 创建 StepResult 模型。
- [ ] 创建 PlanValidator。
- [ ] 创建 LocalExecutor。
- [ ] 创建 BackupStore。
- [ ] 创建 RollbackManager。
- [ ] 创建 HashVerifier。
- [ ] 创建 FileSystemGuard。
- [ ] 创建 DryRun 支持。
- [ ] 每次写入前生成执行计划。
- [ ] 每次写入前展示摘要给 Renderer。
- [ ] 每次写入支持失败反馈。
- [ ] 可回滚步骤失败时尽量回滚。
- [ ] 不可回滚步骤必须提前标记风险。
- [ ] 部分成功时记录失败位置和下一步建议。

## 6. Tool Adapter 框架任务

- [ ] 创建 ToolAdapter 接口。
- [ ] 创建 AdapterManifest schema。
- [ ] Adapter 声明 adapterId、adapterVersion、toolName、supportedPlatforms。
- [ ] Adapter 声明默认扫描路径。
- [ ] Adapter 声明 Skill 目标路径识别规则。
- [ ] Adapter 声明 MCP 配置路径识别规则。
- [ ] Adapter 声明 Plugin 目标路径识别规则。
- [ ] Adapter 声明支持 symlink、copy、配置写入、受控安装能力。
- [ ] Adapter 声明是否支持连接检测、dry-run、回滚。
- [ ] Adapter 不直接访问服务端权限接口。
- [ ] 创建 AdapterRegistry。
- [ ] 创建 AdapterScanner。
- [ ] 创建 AdapterCapabilityMatcher。
- [ ] 默认路径必须可配置，不允许硬编码不可验证路径。
- [ ] Codex、Claude、Cursor、Windsurf、opencode 等适配器可先提供 dry-run 实现和路径验证说明。

## 7. Skill 本地执行任务

- [ ] 安装前请求服务端下载凭证。
- [ ] 服务端拒绝时不得本地继续安装。
- [ ] 下载到临时目录。
- [ ] 校验 SHA-256。
- [ ] 写入 Central Store 新版本目录。
- [ ] 切换当前版本指针。
- [ ] 安装成功写 local_extensions 和 local_extension_versions。
- [ ] 生成本地安装事件。
- [ ] 启用时选择目标工具或项目。
- [ ] 校验目标路径。
- [ ] 生成启用执行计划。
- [ ] 优先 symlink。
- [ ] symlink 失败时降级 copy。
- [ ] 记录实际模式和降级原因。
- [ ] 更新时备份当前版本指针和启用目标元数据。
- [ ] 更新失败时回滚可回滚目标。
- [ ] 卸载前展示启用位置。
- [ ] 卸载只删除托管内容和 Central Store 副本。
- [ ] 停用、卸载、本地清理不因授权收缩而被禁止。

## 8. MCP Server 本地执行任务

- [ ] 安装到工具前请求 MCP 定义和配置模板。
- [ ] 服务端重新校验授权。
- [ ] 展示可写入 MCP 配置的目标工具。
- [ ] 检测目标工具配置路径和写入能力。
- [ ] 用户填写变量。
- [ ] 敏感变量保存到 SecureStore。
- [ ] 本地 DB 只保存敏感变量引用。
- [ ] 渲染配置摘要。
- [ ] 生成配置写入执行计划。
- [ ] 写入前备份原配置。
- [ ] 仅写入 Enterprise Agent Hub 托管配置项。
- [ ] 执行连接检测。
- [ ] local-command 连接检测不得执行有副作用命令。
- [ ] 写入或检测失败时按计划回滚。
- [ ] 更新配置时保留用户本机变量值。
- [ ] 变量新增或删除时提示用户。
- [ ] 卸载配置时只移除托管配置项。
- [ ] 不删除发布者远端 MCP 服务。
- [ ] 生成 MCP 接入、连接检测、更新、卸载本地事件。

## 9. Plugin 本地执行任务

### managed-package

- [ ] 请求下载凭证。
- [ ] 下载插件包并校验 Hash。
- [ ] 检测目标工具和兼容版本。
- [ ] 读取安装清单。
- [ ] 生成安装执行计划。
- [ ] 安装前备份目标位置。
- [ ] 执行 copy/remove/config 等受控动作。
- [ ] 失败时按计划回滚。
- [ ] 更新时生成更新计划并备份。
- [ ] 卸载时按清单删除托管内容。

### config-plugin

- [ ] 获取配置清单。
- [ ] 检测目标工具配置能力。
- [ ] 生成写入计划。
- [ ] 备份原配置。
- [ ] 写入托管配置项。
- [ ] 支持启用、禁用、更新、卸载。
- [ ] 失败时回滚。

### manual-download

- [ ] 授权范围内用户可请求受控下载。
- [ ] 企业内部下载地址下载后仍校验登记 SHA-256。
- [ ] 打开手动安装说明。
- [ ] 用户可标记已安装。
- [ ] 用户可标记已卸载。
- [ ] 卸载时只清理本地记录并提示用户按说明手动处理。

## 10. 本地事件同步任务

- [ ] Skill 安装、启用、停用、更新、卸载事件入队。
- [ ] MCP 配置写入、连接检测、更新、卸载事件入队。
- [ ] Plugin 下载、安装、启用、禁用、更新、卸载事件入队。
- [ ] Hash 校验失败事件入队。
- [ ] symlink 降级 copy 事件入队。
- [ ] 回滚成功或失败事件入队。
- [ ] 部分成功事件入队。
- [ ] 每条事件包含 idempotency_key。
- [ ] 同步后处理 accepted、rejected、ignored。
- [ ] 服务端返回授权收缩、下架、安全下架时刷新本地状态。

## 11. 离线规则任务

- [ ] 离线时禁止新安装、新下载、新接入、新配置写入、新更新。
- [ ] 离线时允许查看本地内容。
- [ ] 离线时允许停用已安装 Skill。
- [ ] 离线时允许卸载本机托管 Skill。
- [ ] 离线时允许停用/卸载已接入 MCP 托管配置。
- [ ] 离线时允许禁用/卸载本机托管 Plugin。
- [ ] 若本机有有效授权缓存且未收到收缩/安全下架标记，可启用已安装 Skill。
- [ ] 恢复联网后同步事件并刷新状态。

## 12. 测试任务

- [ ] ExecutionPlan 生成测试。
- [ ] PlanValidator 测试。
- [ ] LocalExecutor 成功执行测试。
- [ ] LocalExecutor 失败回滚测试。
- [ ] BackupStore 测试。
- [ ] HashVerifier 测试。
- [ ] ToolAdapter manifest 校验测试。
- [ ] Adapter dry-run 测试。
- [ ] Skill 安装测试。
- [ ] Skill symlink 降级 copy 测试。
- [ ] Skill 更新回滚测试。
- [ ] Skill 卸载清理测试。
- [ ] MCP 配置模板渲染测试。
- [ ] MCP 敏感变量 SecureStore 测试。
- [ ] MCP 写入失败回滚测试。
- [ ] MCP 卸载只移除托管项测试。
- [ ] Plugin managed-package 安装/回滚测试。
- [ ] Plugin config-plugin 写入/回滚测试。
- [ ] Plugin manual-download 状态记录测试。
- [ ] 本地事件幂等入队测试。
- [ ] 离线禁止新增主操作测试。
- [ ] 停用/卸载不受授权收缩限制测试。
- [ ] 客户端测试命令通过。

## 13. 阶段验收

- [ ] 本地执行层和 UI/Renderer 分离。
- [ ] 所有本地写入先生成执行计划。
- [ ] 支持备份、失败反馈、尽量回滚、部分成功。
- [ ] Tool Adapter 接口稳定。
- [ ] Skill 本地闭环可用。
- [ ] MCP 本地接入闭环可用。
- [ ] Plugin 三种安装模式本地闭环可用。
- [ ] 敏感变量不保存服务端和本地明文。
- [ ] 本地事件同步可去重。
- [ ] 离线规则正确。
- [ ] 所有测试通过。

## 14. 阶段完成记录

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
