# 09. Agent 执行规则

## 1. 工作方式

Agent 每次只能执行一个阶段，不能跨阶段批量实现。每个阶段必须遵守：

1. 先阅读对应需求文档和详细设计文档。
2. 再阅读总清单和当前阶段子清单。
3. 明确本阶段允许范围与禁止范围。
4. 先写或补测试，再实现功能。
5. 完成一项勾选一项。
6. 未验证不得勾选。
7. 阶段完成后更新总清单。
8. 提交前输出变更摘要、验证命令和遗留问题。

## 2. 勾选规则

允许勾选：

```text
- 已经产生代码或文档变更；
- 已经运行对应验证命令；
- 验证结果通过；
- 已经在清单中填写变更文件和验证结果。
```

禁止勾选：

```text
- 只是计划做但尚未实现；
- 只是手工看过但未执行验证命令；
- 依赖后续阶段完成；
- 实现存在明显 TODO 或占位逻辑；
- 失败后未修复。
```

## 3. 每个任务完成后必须填写

```text
变更文件：
验证命令：
验证结果：
遗留问题：
```

## 4. 提交规范

建议每个阶段使用独立分支：

```text
feature/m1-backend-foundation
feature/m2-auth-org-permission
feature/m3-extension-catalog-scope-statistics
feature/m4-submission-precheck-review-audit-notification
feature/m5-package-storage-download-security-preview
feature/m6-desktop-backend-foundation-localdb-ipc
feature/m7-local-executor-tool-adapter-extension-execution
feature/m8-device-update-backup-deploy-acceptance
```

建议提交信息：

```text
feat(server): initialize Spring Boot foundation
feat(server): implement auth org permission foundation
feat(server): implement extension catalog scope statistics
feat(server): implement submission precheck review notification
feat(server): implement package storage download security preview
feat(client): initialize desktop backend localdb ipc
feat(client): implement local executor tool adapters extension execution
feat(ops): implement device update backup deploy acceptance
```

## 5. 禁止事项

所有阶段共同禁止：

- 不得提交真实密码、Token、API Key、下载凭证明文。
- 不得将业务上传文件打包进 Docker 镜像。
- 不得把服务端权限判断放到客户端作为权威。
- 不得让 UI 组件直接写工具目录或配置文件。
- 不得引入未经设计确认的微服务、消息队列、Redis、Elasticsearch。
- 不得跳过 Flyway 直接让 JPA 自动建生产表。
- 不得把异常堆栈直接返回给前端。
- 不得在运行时依赖互联网服务。
- 不得绕过审计日志记录关键业务动作。
- 不得用 TODO 假装完成验收。

## 6. 阶段完成输出格式

每个阶段完成后，Agent 必须输出：

```text
阶段：
分支：
完成项数量：
未完成项数量：
主要变更：
验证命令：
验证结果：
风险与遗留：
下一阶段建议：
```
