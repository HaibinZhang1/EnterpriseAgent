package com.enterpriseagent.hub.review;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
import com.enterpriseagent.hub.extension.ExtensionJson;
import com.enterpriseagent.hub.organization.DepartmentTreeService;
import com.enterpriseagent.hub.submission.SubmissionService;

@Service
public class ReviewService {
    private final JdbcTemplate jdbc;
    private final SubmissionService submissionService;
    private final ExtensionJson json;
    private final AuditService auditService;
    private final DepartmentTreeService departmentTreeService;

    public ReviewService(JdbcTemplate jdbc, SubmissionService submissionService, ExtensionJson json,
            AuditService auditService, DepartmentTreeService departmentTreeService) {
        this.jdbc = jdbc;
        this.submissionService = submissionService;
        this.json = json;
        this.auditService = auditService;
        this.departmentTreeService = departmentTreeService;
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> tasks(CurrentUser actor, String status, int page, int pageSize) {
        requireAdmin(actor);
        var rows = jdbc.queryForList("""
                select * from submissions
                where status in ('PENDING_REVIEW', 'IN_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED')
                order by created_at desc
                """).stream()
                .filter(row -> canReview(actor, row))
                .filter(row -> status == null || statusMatches(row, status))
                .map(this::taskSummary)
                .toList();
        return PageResult.of(rows, page, pageSize);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(CurrentUser actor, UUID submissionId) {
        requireAdmin(actor);
        Map<String, Object> submission = submissionService.requireVisibleSubmission(actor, submissionId);
        if (!canReview(actor, submission)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权查看审核任务");
        }
        return submissionService.detail(submission);
    }

    @Transactional
    public Map<String, Object> decide(CurrentUser actor, UUID submissionId, ReviewDecisionRequest request) {
        requireAdmin(actor);
        Map<String, Object> submission = lockSubmission(submissionId);
        if (actor.id().equals(submission.get("submitter_id"))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "禁止自审");
        }
        if (!canReview(actor, submission)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权处理审核任务");
        }
        String status = String.valueOf(submission.get("status"));
        if (!List.of("PENDING_REVIEW", "IN_REVIEW").contains(status)) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "申请已被处理");
        }
        UUID currentRevisionId = (UUID) submission.get("current_revision_id");
        if (request.revisionId() != null && !request.revisionId().equals(currentRevisionId)) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "不是当前 revision");
        }
        if (request.decision() == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "审核决定不能为空");
        }
        UUID reviewId = UUID.randomUUID();
        jdbc.update("""
                insert into reviews (id, submission_id, revision_id, reviewer_id, reviewer_snapshot, decision, comment, reason_codes)
                values (?, ?, ?, ?, ?::jsonb, ?, ?, ?::jsonb)
                """, reviewId, submissionId, currentRevisionId, actor.id(),
                json.envelope("review", Map.of("name", actor.name(), "role", actor.role().name())), request.decision().name(),
                request.comment(), json.write(request.reasonCodes() == null ? List.of() : request.reasonCodes()));
        String nextStatus = switch (request.decision()) {
            case APPROVE -> "APPROVED";
            case REQUEST_CHANGES -> "CHANGES_REQUESTED";
            case REJECT -> "REJECTED";
        };
        if (request.decision() == ReviewDecision.APPROVE) {
            materializeApproval(submission, currentRevisionId);
            jdbc.update("""
                    update submissions set status = ?, effective_revision_id = ?, decided_at = now(), updated_at = now() where id = ?
                    """, nextStatus, currentRevisionId, submissionId);
        } else {
            jdbc.update("update submissions set status = ?, decided_at = now(), updated_at = now() where id = ?",
                    nextStatus, submissionId);
        }
        audit(actor, request, submissionId, submission, nextStatus);
        insertNotificationOutbox(submission, nextStatus, request.comment());
        return Map.of("submissionId", submissionId, "revisionId", currentRevisionId,
                "decision", request.decision().name(), "status", nextStatus);
    }

    private Map<String, Object> lockSubmission(UUID submissionId) {
        var rows = jdbc.queryForList("select * from submissions where id = ? for update", submissionId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "审核任务不存在");
        }
        return rows.get(0);
    }

    private void materializeApproval(Map<String, Object> submission, UUID revisionId) {
        var revision = jdbc.queryForList("""
                select payload_snapshot::text as payload_snapshot, package_snapshot::text as package_snapshot
                from submission_revisions where id = ?
                """, revisionId).get(0);
        Map<String, Object> payloadEnvelope = json.readMap((String) revision.get("payload_snapshot"));
        Map<String, Object> packageEnvelope = json.readMap((String) revision.get("package_snapshot"));
        Map<String, Object> payload = asStringKeyMap(payloadEnvelope.get("data"));
        Map<String, Object> packageSnapshot = asStringKeyMap(packageEnvelope.get("data"));
        String extensionId = String.valueOf(payload.get("extensionId"));
        String extensionType = String.valueOf(payload.get("extensionType"));
        String submissionType = String.valueOf(payload.get("type"));
        String version = String.valueOf(payload.get("version"));
        Map<String, Object> metadata = asStringKeyMap(payload.get("metadata"));
        Map<String, Object> authorizationScope = asStringKeyMap(payload.get("authorizationScope"));
        String visibilityMode = String.valueOf(payload.getOrDefault("visibilityMode", "PUBLIC_TO_ALL_LOGGED_IN"));
        UUID extensionPk = findExtensionPk(extensionId);
        if ("ARCHIVE".equals(submissionType)) {
            if (extensionPk == null) {
                throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "归档目标扩展不存在");
            }
            jdbc.update("update extensions set status = 'ARCHIVED', archived_at = now(), updated_at = now() where id = ?",
                    extensionPk);
            return;
        }
        UUID versionPk = extensionPk == null ? UUID.randomUUID() : findVersionPk(extensionPk, version);
        boolean versionExists = versionPk != null;
        if (versionPk == null) {
            versionPk = UUID.randomUUID();
        }
        String name = String.valueOf(metadata.getOrDefault("name", extensionId));
        String description = String.valueOf(metadata.getOrDefault("description", ""));
        String category = String.valueOf(metadata.getOrDefault("category", "uncategorized"));
        String tagsJson = json.write(metadata.getOrDefault("tags", List.of()));
        if (extensionPk == null) {
            extensionPk = UUID.randomUUID();
            jdbc.update("""
                    insert into extensions (id, extension_id, type, name, description, category, tags, status,
                      visibility_mode, owner_department_id, maintainer_id, author_id, current_version_id, current_version,
                      risk_level, risk_summary)
                    values (?, ?, ?, ?, ?, ?, ?::jsonb, 'PUBLISHED', ?, ?, ?, ?, ?, ?, 'LOW', '')
                """, extensionPk, extensionId, extensionType, name, description, category, tagsJson,
                    visibilityMode, submission.get("submitter_department_id"), submission.get("submitter_id"),
                    submission.get("submitter_id"), versionPk, version);
        } else {
            jdbc.update("""
                    update extensions set name = ?, description = ?, category = ?, tags = ?::jsonb,
                      status = 'PUBLISHED', visibility_mode = ?, current_version_id = ?, current_version = ?, updated_at = now()
                    where id = ?
                    """, name, description, category, tagsJson, visibilityMode, versionPk, version, extensionPk);
            jdbc.update("delete from extension_authorization_scopes where extension_pk = ?", extensionPk);
        }
        if (!versionExists) {
            jdbc.update("""
                    insert into extension_versions (id, extension_pk, version, status, payload_snapshot, package_snapshot, changelog, published_at)
                    values (?, ?, ?, 'PUBLISHED', ?::jsonb, ?::jsonb, ?, now())
                    """, versionPk, extensionPk, version, revision.get("payload_snapshot"), revision.get("package_snapshot"),
                    String.valueOf(metadata.getOrDefault("changeLog", "")));
        }
        attachPackageObject(extensionPk, extensionId, version, packageSnapshot);
        createScope(extensionPk, authorizationScope, (UUID) submission.get("submitter_department_id"));
        if ("MCP_SERVER".equals(extensionType)) {
            jdbc.update("""
                    insert into mcp_definitions (id, extension_pk, access_type, transport, config_schema)
                    values (?, ?, 'remote-http', 'streamable-http', '{}'::jsonb)
                    on conflict (extension_pk) do nothing
                    """, UUID.randomUUID(), extensionPk);
        }
        if ("PLUGIN".equals(extensionType)) {
            jdbc.update("""
                    insert into plugin_definitions (id, extension_pk, install_mode, target_tools, manifest)
                    values (?, ?, 'CONFIG_PLUGIN', '[]'::jsonb, '{}'::jsonb)
                    on conflict (extension_pk) do nothing
                    """, UUID.randomUUID(), extensionPk);
        }
    }

    private void attachPackageObject(UUID extensionPk, String extensionId, String version, Map<String, Object> packageSnapshot) {
        Object packageIdValue = packageSnapshot.get("packageId");
        if (packageIdValue == null) {
            return;
        }
        try {
            UUID packageId = UUID.fromString(String.valueOf(packageIdValue));
            jdbc.update("""
                    update package_objects
                       set extension_pk = ?,
                           extension_business_id = ?,
                           version = ?,
                           object_id = ?
                     where id = ?
                    """, extensionPk, extensionId, version, extensionPk, packageId);
            jdbc.update("""
                    update extensions
                       set risk_level = coalesce((select risk_level from package_objects where id = ?), risk_level),
                           risk_summary = coalesce((select risk_summary::text from package_objects where id = ?), risk_summary)
                     where id = ?
                    """, packageId, packageId, extensionPk);
        } catch (IllegalArgumentException ignored) {
            // Legacy placeholder snapshots have no package object to attach.
        }
    }

    private void createScope(UUID extensionPk, Map<String, Object> authorizationScope, UUID defaultDepartmentId) {
        String scopeType = String.valueOf(authorizationScope.getOrDefault("scopeType", "ALL_EMPLOYEES"));
        UUID scopeId = UUID.randomUUID();
        jdbc.update("insert into extension_authorization_scopes (id, extension_pk, scope_type) values (?, ?, ?)",
                scopeId, extensionPk, scopeType);
        if (!"ALL_EMPLOYEES".equals(scopeType)) {
            Object departments = authorizationScope.get("departments");
            if (departments instanceof Iterable<?> iterable) {
                for (Object item : iterable) {
                    if (item instanceof Map<?, ?> map) {
                        UUID departmentId = UUID.fromString(String.valueOf(map.get("departmentId")));
                        Object includeChildrenValue = map.get("includeChildren");
                        boolean includeChildren = Boolean.parseBoolean(String.valueOf(includeChildrenValue));
                        jdbc.update("""
                                insert into extension_authorized_departments (id, scope_id, department_id, include_children)
                                values (?, ?, ?, ?)
                                """, UUID.randomUUID(), scopeId, departmentId, includeChildren);
                    }
                }
            } else {
                jdbc.update("""
                        insert into extension_authorized_departments (id, scope_id, department_id, include_children)
                        values (?, ?, ?, ?)
                        """, UUID.randomUUID(), scopeId, defaultDepartmentId, "DEPARTMENT_TREE".equals(scopeType));
            }
        }
    }

    private UUID findExtensionPk(String extensionId) {
        var rows = jdbc.queryForList("select id from extensions where extension_id = ?", extensionId);
        return rows.isEmpty() ? null : (UUID) rows.get(0).get("id");
    }

    private UUID findVersionPk(UUID extensionPk, String version) {
        var rows = jdbc.queryForList("select id from extension_versions where extension_pk = ? and version = ?",
                extensionPk, version);
        return rows.isEmpty() ? null : (UUID) rows.get(0).get("id");
    }

    private Map<String, Object> asStringKeyMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Map<String, Object> output = new LinkedHashMap<>();
        map.forEach((key, mapValue) -> output.put(String.valueOf(key), mapValue));
        return output;
    }

    private void insertNotificationOutbox(Map<String, Object> submission, String status, String comment) {
        Map<String, Object> notification = new LinkedHashMap<>();
        notification.put("userId", submission.get("submitter_id").toString());
        notification.put("type", "REVIEW_DECISION");
        notification.put("title", "发布申请审核结果");
        notification.put("summary", "申请 " + submission.get("target_extension_id") + " 审核状态：" + status);
        notification.put("objectType", "submission");
        notification.put("objectId", submission.get("id").toString());
        notification.put("status", status);
        notification.put("comment", comment);
        jdbc.update("""
                insert into outbox_events (id, event_type, aggregate_type, aggregate_id, payload, status, retry_count)
                values (?, 'NOTIFICATION_REQUESTED', 'submission', ?, ?::jsonb, 'NEW', 0)
                """, UUID.randomUUID(), submission.get("id"), json.envelope("notification", notification));
    }

    private void audit(CurrentUser actor, ReviewDecisionRequest request, UUID submissionId, Map<String, Object> submission,
            String nextStatus) {
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(Map.of("name", actor.name(), "role", actor.role().name()))
                .actorDepartmentSnapshot(Map.of("departmentId", actor.departmentId().toString(), "departmentName", actor.departmentName()))
                .objectType("submission")
                .objectId(submissionId.toString())
                .objectNameSnapshot(String.valueOf(submission.get("target_extension_id")))
                .action("review.decision")
                .result(AuditResult.SUCCESS)
                .reason(request.comment())
                .beforeSummary(json.envelopeMap("audit", Map.of("status", submission.get("status"))))
                .afterSummary(json.envelopeMap("audit", Map.of("status", nextStatus, "decision", request.decision().name())))
                .build());
    }

    private Map<String, Object> taskSummary(Map<String, Object> row) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("submissionId", row.get("id"));
        item.put("type", row.get("type"));
        item.put("extensionType", row.get("extension_type"));
        item.put("extensionId", row.get("target_extension_id"));
        item.put("submitterId", row.get("submitter_id"));
        item.put("status", row.get("status"));
        item.put("currentRevisionId", row.get("current_revision_id"));
        item.put("createdAt", row.get("created_at"));
        return item;
    }

    private boolean statusMatches(Map<String, Object> row, String status) {
        return switch (status) {
            case "PENDING" -> List.of("PENDING_REVIEW", "IN_REVIEW").contains(String.valueOf(row.get("status")));
            case "PROCESSED" -> List.of("APPROVED", "REJECTED", "CHANGES_REQUESTED").contains(String.valueOf(row.get("status")));
            default -> status.equals(row.get("status"));
        };
    }

    private boolean canReview(CurrentUser actor, Map<String, Object> submission) {
        if (actor.isSystemAdmin()) {
            return true;
        }
        if (!actor.isDepartmentAdmin()) {
            return false;
        }
        Object ownerDepartment = submission.get("review_owner_department_id");
        return ownerDepartment instanceof UUID departmentId
                && departmentTreeService.isSelfOrDescendant(actor.departmentId(), departmentId);
    }

    private void requireAdmin(CurrentUser actor) {
        if (!actor.isAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权执行审核操作");
        }
    }
}
