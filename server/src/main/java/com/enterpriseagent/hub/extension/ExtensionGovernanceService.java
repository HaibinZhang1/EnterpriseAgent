package com.enterpriseagent.hub.extension;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.common.audit.AuditRecord;
import com.enterpriseagent.hub.common.audit.AuditResult;
import com.enterpriseagent.hub.common.audit.AuditService;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.common.pagination.PageResult;

@Service
public class ExtensionGovernanceService {
    private final JdbcTemplate jdbc;
    private final AuditService auditService;
    private final ExtensionCatalogService catalogService;
    private final ExtensionJson json;

    public ExtensionGovernanceService(JdbcTemplate jdbc, AuditService auditService,
            ExtensionCatalogService catalogService, ExtensionJson json) {
        this.jdbc = jdbc;
        this.auditService = auditService;
        this.catalogService = catalogService;
        this.json = json;
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> mine(CurrentUser actor, int page, int pageSize) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select * from extensions where author_id = ? or maintainer_id = ? order by created_at desc
                """, actor.id(), actor.id()).stream()
                .map(this::selfSummary)
                .toList();
        return PageResult.of(rows, page, pageSize);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> selfDetail(CurrentUser actor, String extensionId) {
        Map<String, Object> row = requireExtension(extensionId);
        requireAuthorOrMaintainer(actor, row);
        return selfSummary(row);
    }

    @Transactional
    public Map<String, Object> selfDelist(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireAuthorOrMaintainer(actor, row);
        updateStatus(actor, row, "DELISTED", "extension.delist", reason(request));
        return result(extensionId, "DELISTED");
    }

    @Transactional
    public Map<String, Object> selfReduceScope(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireAuthorOrMaintainer(actor, row);
        replaceScope(actor, row, request == null ? null : request.targetScope(), "extension.scope.reduce", reason(request));
        return result(extensionId, "SCOPE_REDUCED");
    }

    @Transactional
    public Map<String, Object> selfReduceVisibility(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireAuthorOrMaintainer(actor, row);
        reduceVisibility(actor, row, reason(request));
        return result(extensionId, "VISIBILITY_REDUCED");
    }

    @Transactional
    public Map<String, Object> adminDelist(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireManageExtension(actor, row);
        updateStatus(actor, row, "DELISTED", "extension.delist", reason(request));
        return result(extensionId, "DELISTED");
    }

    @Transactional
    public Map<String, Object> adminSecurityDelist(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        if (!actor.isSystemAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "安全下架仅系统管理员可执行");
        }
        updateStatus(actor, requireExtension(extensionId), "SECURITY_DELISTED", "extension.security_delist", reason(request));
        return result(extensionId, "SECURITY_DELISTED");
    }

    @Transactional
    public Map<String, Object> adminRelist(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireManageExtension(actor, row);
        if ("ARCHIVED".equals(String.valueOf(row.get("status")))) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "归档扩展不可重新上架");
        }
        updateStatus(actor, row, "PUBLISHED", "extension.relist", reason(request));
        return result(extensionId, "PUBLISHED");
    }

    @Transactional
    public Map<String, Object> adminArchive(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireManageExtension(actor, row);
        updateStatus(actor, row, "ARCHIVED", "extension.archive", reason(request));
        jdbc.update("update extensions set archived_at = coalesce(archived_at, now()) where id = ?", row.get("id"));
        return result(extensionId, "ARCHIVED");
    }

    @Transactional
    public Map<String, Object> adminReduceScope(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireManageExtension(actor, row);
        replaceScope(actor, row, request == null ? null : request.targetScope(),
                "extension.scope.reduce", reason(request));
        return result(extensionId, "SCOPE_REDUCED");
    }

    @Transactional
    public Map<String, Object> adminReduceVisibility(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireManageExtension(actor, row);
        reduceVisibility(actor, row, reason(request));
        return result(extensionId, "VISIBILITY_REDUCED");
    }

    @Transactional
    public Map<String, Object> adminTransferOwnership(CurrentUser actor, String extensionId, ExtensionGovernanceRequest request) {
        Map<String, Object> row = requireExtension(extensionId);
        requireManageExtension(actor, row);
        UUID afterOwnerDepartmentId = request == null ? null : request.targetOwnerDepartmentId();
        UUID afterMaintainerId = request == null ? null : request.targetMaintainerId();
        if (afterOwnerDepartmentId == null && afterMaintainerId == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "归属部门或维护人至少填写一个");
        }
        UUID beforeOwnerDepartmentId = (UUID) row.get("owner_department_id");
        UUID beforeMaintainerId = (UUID) row.get("maintainer_id");
        UUID targetOwner = afterOwnerDepartmentId == null ? beforeOwnerDepartmentId : afterOwnerDepartmentId;
        UUID targetMaintainer = afterMaintainerId == null ? beforeMaintainerId : afterMaintainerId;
        if (Objects.equals(targetOwner, beforeOwnerDepartmentId) && Objects.equals(targetMaintainer, beforeMaintainerId)) {
            return result(extensionId, "OWNERSHIP_UNCHANGED");
        }
        jdbc.update("""
                update extensions set owner_department_id = ?, maintainer_id = ?, updated_at = now() where id = ?
                """, targetOwner, targetMaintainer, row.get("id"));
        jdbc.update("""
                insert into extension_ownership_history (id, extension_pk, before_owner_department_id,
                  after_owner_department_id, before_maintainer_id, after_maintainer_id, reason, changed_by)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), row.get("id"), beforeOwnerDepartmentId, targetOwner,
                beforeMaintainerId, targetMaintainer, reason(request), actor.id());
        audit(actor, row, "extension.ownership.transfer", reason(request),
                ownershipSummary(beforeOwnerDepartmentId, beforeMaintainerId),
                ownershipSummary(targetOwner, targetMaintainer));
        return result(extensionId, "OWNERSHIP_TRANSFERRED");
    }

    private void updateStatus(CurrentUser actor, Map<String, Object> row, String status, String action, String reason) {
        String before = String.valueOf(row.get("status"));
        if (status.equals(before)) {
            return;
        }
        jdbc.update("update extensions set status = ?, updated_at = now() where id = ?", status, row.get("id"));
        audit(actor, row, action, reason, Map.of("status", before), Map.of("status", status));
    }

    private void reduceVisibility(CurrentUser actor, Map<String, Object> row, String reason) {
        String before = String.valueOf(row.get("visibility_mode"));
        if ("AUTHORIZED_ONLY".equals(before)) {
            return;
        }
        jdbc.update("update extensions set visibility_mode = 'AUTHORIZED_ONLY', updated_at = now() where id = ?", row.get("id"));
        audit(actor, row, "extension.visibility.reduce", reason, Map.of("visibilityMode", before),
                Map.of("visibilityMode", "AUTHORIZED_ONLY"));
    }

    private void replaceScope(CurrentUser actor, Map<String, Object> row, Map<String, Object> targetScope,
            String action, String reason) {
        if (targetScope == null || targetScope.get("scopeType") == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "目标授权范围不能为空");
        }
        ScopeType scopeType;
        try {
            scopeType = ScopeType.valueOf(String.valueOf(targetScope.get("scopeType")));
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "授权范围类型不合法");
        }
        if (scopeType == ScopeType.ALL_EMPLOYEES) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "授权收缩不能扩大到全员");
        }
        jdbc.update("delete from extension_authorization_scopes where extension_pk = ?", row.get("id"));
        UUID scopeId = UUID.randomUUID();
        jdbc.update("insert into extension_authorization_scopes (id, extension_pk, scope_type) values (?, ?, ?)",
                scopeId, row.get("id"), scopeType.name());
        Object departments = targetScope.get("departments");
        if (!(departments instanceof Iterable<?> iterable)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "目标部门不能为空");
        }
        int count = 0;
        for (Object item : iterable) {
            Map<String, Object> department = stringMap(item);
            UUID departmentId = UUID.fromString(String.valueOf(department.get("departmentId")));
            boolean includeChildren = Boolean.parseBoolean(String.valueOf(department.getOrDefault("includeChildren", false)));
            jdbc.update("""
                    insert into extension_authorized_departments (id, scope_id, department_id, include_children)
                    values (?, ?, ?, ?)
                    """, UUID.randomUUID(), scopeId, departmentId, includeChildren);
            count++;
        }
        if (count == 0) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "目标部门不能为空");
        }
        audit(actor, row, action, reason, Map.of("scope", "previous"), Map.of("scope", targetScope));
    }

    private Map<String, Object> selfSummary(Map<String, Object> row) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", row.get("id"));
        item.put("extensionId", row.get("extension_id"));
        item.put("type", row.get("type"));
        item.put("name", row.get("name"));
        item.put("status", row.get("status"));
        item.put("visibilityMode", row.get("visibility_mode"));
        item.put("currentVersion", row.get("current_version"));
        item.put("ownerDepartmentId", row.get("owner_department_id"));
        item.put("maintainerId", row.get("maintainer_id"));
        item.put("authorId", row.get("author_id"));
        return item;
    }

    private Map<String, Object> ownershipSummary(UUID ownerDepartmentId, UUID maintainerId) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("ownerDepartmentId", ownerDepartmentId);
        summary.put("maintainerId", maintainerId);
        return summary;
    }

    private Map<String, Object> requireExtension(String extensionId) {
        var rows = jdbc.queryForList("select * from extensions where extension_id = ?", extensionId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "扩展不存在");
        }
        return rows.get(0);
    }

    private void requireAuthorOrMaintainer(CurrentUser actor, Map<String, Object> row) {
        if (!actor.id().equals(row.get("author_id")) && !actor.id().equals(row.get("maintainer_id"))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "只能治理自己维护的扩展");
        }
    }

    private void requireAdmin(CurrentUser actor) {
        if (!actor.isAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权执行扩展治理操作");
        }
    }

    private void requireManageExtension(CurrentUser actor, Map<String, Object> row) {
        requireAdmin(actor);
        if (!catalogService.canManageExtension(actor, row)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权管理该扩展");
        }
    }

    private void audit(CurrentUser actor, Map<String, Object> row, String action, String reason,
            Map<String, Object> before, Map<String, Object> after) {
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(Map.of("name", actor.name(), "role", actor.role().name()))
                .actorDepartmentSnapshot(Map.of("departmentId", actor.departmentId().toString(),
                        "departmentName", actor.departmentName()))
                .objectType("extension")
                .objectId(row.get("id").toString())
                .objectNameSnapshot(String.valueOf(row.get("extension_id")))
                .action(action)
                .result(AuditResult.SUCCESS)
                .reason(reason)
                .beforeSummary(json.envelopeMap("audit", before))
                .afterSummary(json.envelopeMap("audit", after))
                .build());
    }

    private String reason(ExtensionGovernanceRequest request) {
        if (request == null) {
            return null;
        }
        if (request.reason() != null) {
            return request.reason();
        }
        if (request.securityReason() != null) {
            return request.securityReason();
        }
        if (request.reasonDetail() != null) {
            return request.reasonDetail();
        }
        return request.reasonType();
    }

    private Map<String, Object> result(String extensionId, String status) {
        return Map.of("extensionId", extensionId, "status", status);
    }

    private Map<String, Object> stringMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "目标部门格式不合法");
        }
        Map<String, Object> output = new LinkedHashMap<>();
        map.forEach((key, mapValue) -> output.put(String.valueOf(key), mapValue));
        return output;
    }
}
