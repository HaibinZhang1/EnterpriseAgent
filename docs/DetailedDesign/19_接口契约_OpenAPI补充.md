# 19. 接口契约 OpenAPI 补充

## 19.1 目标

本文件补齐 `05_服务端接口契约.md` 中仍偏清单化的管理端、客户端设备、客户端更新和设置接口，使后续 Agent 可以据此生成 Controller、DTO、鉴权注解、契约测试和 TypeScript API Client。

设计原则：

1. 所有响应统一包裹 `ApiResponse<T>`，必须包含 `requestId`。
2. 所有列表响应统一使用 `PageResult<T>`。
3. 所有管理端写操作必须携带 `Idempotency-Key`。
4. 所有写操作必须重新计算服务端权限，不信任客户端传入的角色、部门、授权范围、可见选项。
5. 所有失败必须返回稳定错误码。
6. 所有危险操作必须写审计日志；设置版本冲突、权限拒绝等失败也应写失败审计。

## 19.2 通用 Schema

### ApiResponse

```json
{
  "requestId": "req_01HX...",
  "success": true,
  "data": {},
  "error": null
}
```

失败：

```json
{
  "requestId": "req_01HX...",
  "success": false,
  "data": null,
  "error": {
    "code": "permission_denied",
    "message": "无权执行该操作",
    "details": {
      "operation": "admin.user.freeze",
      "targetUserId": "uuid"
    },
    "retryable": false
  }
}
```

### PageResult

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 132,
  "hasNext": true
}
```

### VersionedWrite

带乐观锁的写操作统一使用以下字段之一：

- `expectedVersion`：用于 settings、client update 等显式版本对象；
- `expectedUpdatedAt`：用于用户、部门等没有业务版本号但需要避免覆盖的对象；
- `expectedStatus`：用于审核、客户端更新发布、下架/重新上架等状态机对象。

并发冲突返回：

- `review_already_processed`；
- `setting_version_conflict`；
- `state_conflict`；
- 或该业务域更具体的错误码。

## 19.3 管理端部门 API

### GET /admin/departments/tree

权限：部门管理员、系统管理员。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| includeDisabled | boolean | 否 | 是否包含停用部门，默认 false |
| rootDepartmentId | uuid | 否 | 系统管理员可指定根；部门管理员只能查询自身管理范围 |

响应 `DepartmentTreeDto[]`：

```json
[
  {
    "id": "uuid",
    "name": "研发部",
    "parentId": null,
    "status": "ACTIVE",
    "path": ["研发部"],
    "userCount": 28,
    "activeUserCount": 27,
    "departmentAdminCount": 2,
    "activeExtensionCount": 5,
    "children": []
  }
]
```

权限规则：

- 部门管理员只能看到本部门及下级部门；
- 系统管理员可看到全量部门树；
- 部门暂不支持移动，因此 API 不提供 move 操作。

### POST /admin/departments

权限：部门管理员、系统管理员。部门管理员只能在管理范围内创建下级部门。

请求：

```json
{
  "parentId": "uuid",
  "name": "数据平台组",
  "reason": "新增团队"
}
```

响应：`DepartmentDto`。

校验：

1. `name` 在同一父部门下不可重复。
2. `parentId` 必须存在且未停用。
3. 部门管理员创建目标必须落在其管理范围内。
4. 创建成功写 `department.create` 审计。

### PATCH /admin/departments/{id}

请求：

```json
{
  "name": "数据平台部",
  "expectedUpdatedAt": "2026-05-07T09:00:00Z",
  "reason": "部门更名"
}
```

响应：`DepartmentDto`。

限制：

- 不允许修改 `parentId`；
- 不允许把停用部门直接改为启用，启用必须走 `/enable`；
- 修改部门名不影响历史审计快照。

### POST /admin/departments/{id}/disable

请求：

```json
{
  "reason": "组织调整",
  "expectedUpdatedAt": "2026-05-07T09:00:00Z"
}
```

服务端处理：

1. 校验管理员范围；
2. 校验停用后不会破坏最后可用系统管理员保护；
3. 撤销该部门用户已有会话；
4. 归属该部门的活跃扩展在社区视为失效；
5. 写 `department.disable` 审计。

### POST /admin/departments/{id}/enable

请求：

```json
{
  "reason": "恢复使用",
  "expectedUpdatedAt": "2026-05-07T09:30:00Z"
}
```

恢复后用户登录和扩展可用性按当前组织、状态、授权范围和可见选项重新计算。

### DELETE /admin/departments/{id}

请求：

```json
{
  "reason": "清理空部门",
  "expectedUpdatedAt": "2026-05-07T09:30:00Z"
}
```

删除条件：

- 部门必须已停用；
- 无子部门；
- 无未删除用户；
- 无活跃扩展归属；
- 无待处理发布申请；
- 不影响审计历史展示。

阻塞返回：

```json
{
  "code": "department_delete_blocked",
  "details": {
    "childDepartmentCount": 1,
    "activeUserCount": 5,
    "activeExtensionCount": 2,
    "pendingSubmissionCount": 1
  }
}
```

## 19.4 管理端用户 API

### GET /admin/users

查询参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| keyword | string | 姓名或手机号模糊搜索 |
| departmentId | uuid | 部门过滤 |
| includeChildren | boolean | 是否包含下级部门 |
| role | enum | NORMAL_USER / DEPARTMENT_ADMIN / SYSTEM_ADMIN |
| status | enum | ACTIVE / FROZEN / DELETED |
| page/pageSize | integer | 分页 |

响应 `PageResult<UserAdminListItem>`：

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "张三",
      "phoneMasked": "138****0000",
      "departmentId": "uuid",
      "departmentName": "研发部",
      "role": "NORMAL_USER",
      "status": "ACTIVE",
      "lastLoginAt": "2026-05-06T10:00:00Z",
      "clientDeviceCount": 2,
      "updatedAt": "2026-05-06T10:00:00Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "hasNext": false
}
```

### POST /admin/users

请求：

```json
{
  "name": "李四",
  "phone": "13900000000",
  "departmentId": "uuid",
  "role": "NORMAL_USER",
  "initialPassword": "Temp#123456",
  "mustChangePassword": true,
  "reason": "新增员工账号"
}
```

规则：

1. 手机号唯一，但技术主键必须是不可变 `userID`。
2. 密码只参与 Hash，不返回明文，不写日志和审计。
3. 部门管理员不得创建系统管理员；只能创建管理范围内普通用户或下级部门管理员。
4. 系统管理员可创建三类角色，但仍不得破坏最后系统管理员保护。

响应：`UserAdminDetailDto`。

### GET /admin/users/{id}

响应包含：

- 用户基本信息；
- 角色和部门；
- 会话失效摘要；
- 最近客户端设备；
- 最近审计摘要；
- 可执行操作列表。

### PATCH /admin/users/{id}

请求：

```json
{
  "name": "李四",
  "phone": "13900000001",
  "departmentId": "uuid",
  "role": "DEPARTMENT_ADMIN",
  "expectedUpdatedAt": "2026-05-07T09:00:00Z",
  "reason": "调整为下级部门管理员"
}
```

规则：

- 角色变化、部门变化、手机号变化必须撤销既有 session；
- 部门管理员不得操作自己，不得操作同级、上级、横向部门管理员或系统管理员；
- 不得删除、冻结或降权最后一个可用系统管理员；
- 不得把已有用户通过批量导入方式变更角色。

### POST /admin/users/{id}/freeze

```json
{
  "reason": "离职冻结",
  "expectedUpdatedAt": "2026-05-07T09:00:00Z"
}
```

成功后撤销用户所有会话，写 `user.freeze` 审计。

### POST /admin/users/{id}/unfreeze

```json
{
  "reason": "恢复账号",
  "expectedUpdatedAt": "2026-05-07T09:00:00Z"
}
```

### DELETE /admin/users/{id}

逻辑删除，不物理删除审计关联。成功后：

- 撤销所有 session；
- 用户不可登录；
- 历史作者、审核人、审计快照不变；
- 维护人转移需通过扩展治理接口单独处理。

### POST /admin/users/{id}/reset-password

请求：

```json
{
  "mustChangePassword": true,
  "reason": "用户忘记密码"
}
```

响应只返回一次：

```json
{
  "resetToken": "only-return-once",
  "expiresAt": "2026-05-07T10:00:00Z",
  "mustChangePassword": true
}
```

明文 token 不得写数据库、审计、日志。数据库只保存 token hash。

## 19.5 管理端扩展治理 API

### GET /admin/extensions

查询参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| keyword | string | Extension ID / 名称 / 作者搜索 |
| type | enum | SKILL / MCP_SERVER / PLUGIN |
| status | enum | PUBLISHED / DELISTED / SECURITY_DELISTED / ARCHIVED |
| visibilityMode | enum | PUBLIC_TO_ALL_LOGGED_IN / AUTHORIZED_ONLY |
| ownerDepartmentId | uuid | 归属部门 |
| includeChildren | boolean | 包含下级部门 |
| maintainerId | uuid | 维护人 |
| riskLevel | enum | LOW / MEDIUM / HIGH |
| page/pageSize | integer | 分页 |

响应字段：

```json
{
  "extensionId": "code-review-skill",
  "type": "SKILL",
  "name": "代码审查 Skill",
  "status": "PUBLISHED",
  "visibilityMode": "PUBLIC_TO_ALL_LOGGED_IN",
  "currentVersion": "1.2.0",
  "authorSnapshot": {"name": "张三", "departmentName": "研发部"},
  "maintainer": {"id": "uuid", "name": "张三"},
  "ownerDepartment": {"id": "uuid", "name": "研发部"},
  "metrics": {"stars": 10, "downloads": 32, "usage": null},
  "updatedAt": "2026-05-07T09:00:00Z"
}
```

### GET /admin/extensions/{extensionId}

响应必须包含以下 section：

- 主档和当前版本；
- 类型化定义：Skill 文件清单 / MCP definition / Plugin manifest；
- 授权范围当前值和历史快照；
- 可见选项；
- 统计摘要；
- 审核记录；
- AI 预审历史；
- 本地事件异常摘要；
- 生命周期事件；
- 可执行治理动作列表。

### POST /admin/extensions/{extensionId}/delist

请求：

```json
{
  "reasonType": "MAINTENANCE",
  "reasonDetail": "维护调整",
  "expectedStatus": "PUBLISHED"
}
```

权限：

- 部门管理员可下架管理范围内扩展；
- 系统管理员可下架任意扩展；
- 作者侧下架走 `/me/extensions/{extensionId}/delist`。

成功：状态变为 `DELISTED`，不再社区展示，不再允许新安装、接入、复制配置、下载或更新；存量本地停用和卸载仍允许。

### POST /admin/extensions/{extensionId}/security-delist

仅系统管理员。

```json
{
  "securityReason": "疑似泄露敏感配置",
  "impactSummary": "12 个用户已接入",
  "handlingAdvice": "建议卸载或等待修复版本",
  "existingUsagePolicy": "BLOCK_NEW_ENABLE",
  "expectedStatus": "PUBLISHED"
}
```

`existingUsagePolicy`：

- `WARN_ONLY`；
- `BLOCK_NEW_ENABLE`；
- `FORCE_DISABLE_MANAGED_ITEMS`。

成功后必须：

1. 状态变更为 `SECURITY_DELISTED`；
2. 通知存量用户；
3. 本地页下一次同步标记安全风险；
4. 写安全下架审计；
5. 统计榜单排除该扩展。

### POST /admin/extensions/{extensionId}/relist

请求：

```json
{
  "reason": "维护完成",
  "fixSummary": "无包内容变化，仅恢复上架",
  "expectedStatus": "DELISTED"
}
```

规则：

- 非安全下架且版本、元信息、授权范围、可见选项不变时，可由具备权限管理员直接重新上架；
- 涉及新版本、元信息修改、授权扩大或展示扩大时，必须创建 submission；
- 安全下架重新上架只能由系统管理员处理；安全风险修复涉及包或权限变化时必须审核。

### POST /admin/extensions/{extensionId}/archive

```json
{
  "reason": "废弃，不再维护",
  "confirmExtensionId": "code-review-skill",
  "expectedStatus": "DELISTED"
}
```

归档为终态：不得重新上架、不得发布新版本、不得修改授权和可见选项，Extension ID 永久保留不复用。

### POST /admin/extensions/{extensionId}/scope/reduce

```json
{
  "targetScope": {
    "scopeType": "SPECIFIED_DEPARTMENTS",
    "departments": [
      {"departmentId": "uuid", "includeChildren": true}
    ]
  },
  "reason": "缩小可用范围",
  "expectedScopeVersion": 5
}
```

服务端必须判定为授权收缩才能直接生效；若是授权扩大，返回 `validation_failed` 并提示应创建 submission。

### POST /admin/extensions/{extensionId}/visibility/reduce

```json
{
  "targetVisibilityMode": "AUTHORIZED_ONLY",
  "reason": "降低外显范围",
  "expectedVisibilityMode": "PUBLIC_TO_ALL_LOGGED_IN"
}
```

展示收缩直接生效并写审计；展示扩大必须创建 submission。

### POST /admin/extensions/{extensionId}/ownership-transfer

```json
{
  "targetMaintainerId": "uuid",
  "targetOwnerDepartmentId": "uuid",
  "reason": "团队职责转移",
  "expectedUpdatedAt": "2026-05-07T09:00:00Z"
}
```

规则：

- 部门管理员只能在管理范围内转移维护人和归属部门；
- 系统管理员可全局转移；
- 不修改历史作者、历史部门、历史审核快照；
- 写 `extension.ownership.transfer` 审计并通知新维护人。

## 19.6 客户端设备 API

### POST /client-devices/register

桌面客户端登录成功后调用。

请求：

```json
{
  "deviceId": "dev_01HX",
  "hostnameHash": "sha256",
  "osVersion": "Windows 11 23H2",
  "arch": "x64",
  "clientVersion": "1.0.0",
  "installChannel": "STABLE"
}
```

响应：

```json
{
  "registered": true,
  "serverTime": "2026-05-07T10:00:00Z",
  "deviceStatus": "ACTIVE",
  "updateHint": {
    "updateAvailable": false
  }
}
```

### POST /client-devices/heartbeat

```json
{
  "deviceId": "dev_01HX",
  "clientVersion": "1.0.0",
  "localEventQueueSize": 3,
  "lastSyncAt": "2026-05-07T09:58:00Z"
}
```

心跳属于设备事件，不写审计；版本变化、异常和更新失败写设备事件。

### POST /client-devices/events

```json
{
  "deviceId": "dev_01HX",
  "events": [
    {
      "idempotencyKey": "dev_01HX:update:1.1.0:failed",
      "eventType": "CLIENT_UPDATE_FAILED",
      "result": "FAILURE",
      "errorCode": "signature_invalid",
      "payloadSummary": {
        "fromVersion": "1.0.0",
        "toVersion": "1.1.0"
      },
      "occurredAt": "2026-05-07T10:00:00Z"
    }
  ]
}
```

### GET /admin/client-devices

查询参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| keyword | string | 用户名、手机号脱敏匹配、deviceId |
| departmentId | uuid | 部门过滤 |
| includeChildren | boolean | 是否包含下级部门 |
| clientVersion | string | 客户端版本 |
| status | enum | ACTIVE / INACTIVE |
| lastSeenFrom/lastSeenTo | datetime | 在线时间范围 |
| page/pageSize | integer | 分页 |

部门管理员只能看到管理范围内用户设备。

### GET /admin/client-devices/{deviceId}

响应包含：

- 设备摘要；
- 关联用户和部门快照；
- 最近心跳；
- 版本变化；
- 本地事件异常；
- 客户端更新事件；
- 可跳转审计 requestID。

## 19.7 客户端更新 API

### GET /client-updates/check

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| deviceId | string | 是 | 稳定设备 ID |
| currentVersion | string | 是 | 当前客户端版本 |
| arch | string | 是 | x64 |
| channel | string | 否 | STABLE，默认 STABLE |

响应：

```json
{
  "updateAvailable": true,
  "versionId": "uuid",
  "version": "1.1.0",
  "buildNo": "2026050701",
  "forceUpdate": false,
  "minSupportedVersion": "1.0.0",
  "releaseNotes": "修复安装问题",
  "packageSize": 12345678,
  "sha256": "64hex",
  "signatureStatus": "VALID",
  "downloadTicketRequired": true
}
```

### POST /client-updates/{versionId}/download-ticket

请求：

```json
{
  "deviceId": "dev_01HX",
  "currentVersion": "1.0.0"
}
```

服务端校验客户端更新版本状态、设备状态、用户状态和签名状态。下载目的固定为 `CLIENT_UPDATE`，不得计入扩展下载量。

### GET /admin/client-updates

查询参数：`status`、`version`、`page`、`pageSize`。

### POST /admin/client-updates

系统管理员。

```json
{
  "version": "1.1.0",
  "buildNo": "2026050701",
  "platform": "WINDOWS",
  "arch": "X64",
  "channel": "STABLE",
  "forceUpdate": false,
  "minSupportedVersion": "1.0.0",
  "releaseNotes": "修复本地安装失败问题",
  "packageTempUploadId": "tmp_uuid",
  "packageSha256": "64hex",
  "packageSize": 12345678,
  "signatureStatus": "VALID",
  "certificateSummary": {
    "subject": "CN=EnterpriseAgentHub",
    "issuer": "CN=Internal CA"
  }
}
```

创建后状态为 `DRAFT`。签名状态为 `INVALID` 时不得发布。

### POST /admin/client-updates/{id}/upload

适用于先建草稿再上传包的流程。

```json
{
  "packageTempUploadId": "tmp_uuid",
  "packageSha256": "64hex",
  "packageSize": 12345678,
  "signatureStatus": "VALID",
  "certificateSummary": {}
}
```

### POST /admin/client-updates/{id}/publish

```json
{
  "expectedStatus": "DRAFT",
  "reason": "发布 1.1.0 更新"
}
```

发布成功后，客户端检查更新可见。若 `forceUpdate=true`，低于 `minSupportedVersion` 的客户端必须提示强制更新，但本设计不定义 UI。

### POST /admin/client-updates/{id}/pause

```json
{
  "expectedStatus": "PUBLISHED",
  "reason": "发现安装失败率异常"
}
```

暂停后不再向新客户端返回该更新，但已下载用户的本地安装动作不可被服务端强制撤销。

### POST /admin/client-updates/{id}/withdraw

```json
{
  "expectedStatus": "DRAFT",
  "reason": "撤回草稿"
}
```

已发布版本原则上走 `pause`，不直接删除历史记录。

### GET /admin/client-updates/events

查询参数：`versionId`、`deviceId`、`result`、`errorCode`、`from/to`、分页。

用于排查更新失败、签名校验失败、Hash 校验失败和用户取消更新。

## 19.8 设置 API

### GET /settings/public

普通登录用户可读取非敏感设置摘要，例如分类、标签、上传限制摘要、客户端更新策略摘要。不得返回 AI 服务 API Key、Token、下载凭证或内部密钥。

### GET /admin/settings

系统管理员可读取全局设置。敏感值返回脱敏摘要：

```json
{
  "key": "ai.precheck",
  "version": 3,
  "value": {
    "enabled": true,
    "baseUrl": "http://ai.internal",
    "model": "internal-model",
    "apiKey": "******",
    "timeoutMs": 30000,
    "failurePolicy": "CONTINUE_WITH_WARNING"
  },
  "updatedBy": {"id": "uuid", "name": "管理员"},
  "updatedAt": "2026-05-07T09:00:00Z"
}
```

### PATCH /admin/settings/{key}

```json
{
  "expectedVersion": 3,
  "value": {
    "enabled": true,
    "baseUrl": "http://ai.internal",
    "timeoutMs": 30000,
    "failurePolicy": "CONTINUE_WITH_WARNING"
  },
  "reason": "启用内网 AI 预审"
}
```

处理逻辑：

1. 校验系统管理员权限；
2. 校验 key 是否允许修改；
3. 使用强类型 validator 校验 value；
4. 条件更新 `where key = :key and version = :expectedVersion`；
5. 成功后 `version + 1`；
6. 写 `settings_history` 和 `audit_logs`；
7. 返回最新版本。

冲突返回：

```json
{
  "code": "setting_version_conflict",
  "message": "系统设置已被其他管理员修改，请刷新后重试",
  "details": {
    "key": "ai.precheck",
    "expectedVersion": 3,
    "currentVersion": 4
  }
}
```

## 19.9 OpenAPI 生成约束

生成 OpenAPI 3.0 时必须满足：

1. 所有 enum 使用大写下划线形式，例如 `MCP_SERVER`、`REMOTE_HTTP`、`STREAMABLE_HTTP`。
2. 入参允许兼容小写连字符时，只能在 Controller 层规范化，内部 DTO、数据库枚举和 TypeScript 类型统一使用大写下划线。
3. 所有敏感字段添加 `x-sensitive: true` 或等价扩展。
4. 所有写接口声明 `Idempotency-Key` Header。
5. 所有列表接口声明分页参数和排序白名单。
6. 所有错误响应引用统一 `ApiError` schema。
7. 所有管理端接口声明角色权限和管理范围过滤说明。
8. 所有下载接口必须声明 `purpose`，避免统计口径误用。

## 19.10 契约测试清单

| 接口组 | 必测场景 |
|---|---|
| 部门 | 创建、重名、停用、启用、删除阻塞、部门管理员越权 |
| 用户 | 新增、修改角色、冻结、删除、重置密码、最后系统管理员保护 |
| 扩展治理 | 普通下架、安全下架、重新上架、归档、授权收缩、展示收缩、转移维护人 |
| 设备 | 登记、心跳、事件幂等、管理范围过滤 |
| 客户端更新 | 创建、上传、发布、暂停、撤回、检查更新、下载凭证、签名非法拒绝 |
| 设置 | GET 脱敏、PATCH 成功、expectedVersion 冲突、敏感值不入日志 |
