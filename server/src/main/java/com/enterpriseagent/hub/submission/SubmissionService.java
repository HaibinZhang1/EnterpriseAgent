package com.enterpriseagent.hub.submission;

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
import com.enterpriseagent.hub.extension.ScopeType;
import com.enterpriseagent.hub.organization.DepartmentTreeService;
import com.enterpriseagent.hub.packages.PackageUploadService;

@Service
public class SubmissionService {
    private final JdbcTemplate jdbc;
    private final SnapshotService snapshots;
    private final RulePrecheckService rulePrecheckService;
    private final AiPrecheckService aiPrecheckService;
    private final ExtensionJson json;
    private final AuditService auditService;
    private final DepartmentTreeService departmentTreeService;
    private final PackageUploadService packageUploadService;

    public SubmissionService(JdbcTemplate jdbc, SnapshotService snapshots, RulePrecheckService rulePrecheckService,
            AiPrecheckService aiPrecheckService, ExtensionJson json, AuditService auditService,
            DepartmentTreeService departmentTreeService, PackageUploadService packageUploadService) {
        this.jdbc = jdbc;
        this.snapshots = snapshots;
        this.rulePrecheckService = rulePrecheckService;
        this.aiPrecheckService = aiPrecheckService;
        this.json = json;
        this.auditService = auditService;
        this.departmentTreeService = departmentTreeService;
        this.packageUploadService = packageUploadService;
    }

    @Transactional
    public Map<String, Object> create(CurrentUser actor, SubmissionRequest request) {
        snapshots.rejectM5PackageFields(request);
        Map<String, Object> ruleResult = rulePrecheckService.validate(request);
        AiPrecheckService.Result aiResult = aiPrecheckService.precheck(request);
        String packageSnapshot = packageUploadService.consumeForSubmission(actor, request.extensionType(), request.extensionId(),
                request.version(), request.uploadRefs());
        UUID submissionId = UUID.randomUUID();
        UUID revisionId = UUID.randomUUID();
        String ownerType = ownerType(request);
        UUID ownerDepartmentId = "SYSTEM_ADMIN".equals(ownerType) ? null : actor.departmentId();
        jdbc.update("""
                insert into submissions (id, type, extension_type, target_extension_id, submitter_id,
                  submitter_department_id, status, review_owner_type, review_owner_department_id, current_revision_id)
                values (?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?)
                """, submissionId, request.type().name(), request.extensionType().name(), request.extensionId(),
                actor.id(), actor.departmentId(), ownerType, ownerDepartmentId, revisionId);
        jdbc.update("""
                insert into submission_revisions (id, submission_id, revision_no, payload_snapshot, package_snapshot, submitted_by)
                values (?, ?, 1, ?::jsonb, ?::jsonb, ?)
                """, revisionId, submissionId, snapshots.envelope("submission", payload(request)),
                packageSnapshot, actor.id());
        jdbc.update("""
                insert into system_prechecks (id, submission_id, revision_id, rule_status, rule_result,
                  ai_status, ai_result_summary, ai_model, ai_prompt_version)
                values (?, ?, ?, 'PASSED', ?::jsonb, ?, ?::jsonb, ?, ?)
                """, UUID.randomUUID(), submissionId, revisionId, snapshots.envelope("precheck", ruleResult),
                aiResult.status(), snapshots.envelope("precheck", aiResult.summary()), aiResult.model(), aiResult.promptVersion());
        audit(actor, "submission.create", submissionId, request.extensionId(), Map.of("status", "PENDING_REVIEW"));
        insertReviewerNotificationOutbox(submissionId, request.extensionId(), ownerType, ownerDepartmentId);
        return Map.of("submissionId", submissionId, "revisionId", revisionId, "revisionNo", 1,
                "status", "PENDING_REVIEW", "displayStatus", "待审核");
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> mine(CurrentUser actor, int page, int pageSize) {
        var rows = jdbc.queryForList("""
                select * from submissions where submitter_id = ? order by created_at desc
                """, actor.id()).stream().map(this::submissionSummary).toList();
        return PageResult.of(rows, page, pageSize);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(CurrentUser actor, UUID submissionId) {
        Map<String, Object> submission = requireVisibleSubmission(actor, submissionId);
        return detail(submission);
    }

    @Transactional
    public Map<String, Object> withdraw(CurrentUser actor, UUID submissionId) {
        Map<String, Object> submission = requireSubmission(submissionId);
        if (!actor.id().equals(submission.get("submitter_id"))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "只能撤回自己的申请");
        }
        String status = String.valueOf(submission.get("status"));
        if (List.of("APPROVED", "REJECTED", "WITHDRAWN").contains(status)) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "终态申请不可撤回");
        }
        jdbc.update("update submissions set status = 'WITHDRAWN', updated_at = now() where id = ?", submissionId);
        audit(actor, "submission.withdraw", submissionId, String.valueOf(submission.get("target_extension_id")),
                Map.of("status", "WITHDRAWN"));
        return detail(requireSubmission(submissionId));
    }

    @Transactional
    public Map<String, Object> revise(CurrentUser actor, UUID submissionId, SubmissionRequest request) {
        Map<String, Object> submission = requireSubmission(submissionId);
        if (!actor.id().equals(submission.get("submitter_id"))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "只能修改自己的申请");
        }
        if (!"CHANGES_REQUESTED".equals(String.valueOf(submission.get("status")))) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "当前状态不可重新提交");
        }
        snapshots.rejectM5PackageFields(request);
        rulePrecheckService.validateRevision(request, submissionId);
        AiPrecheckService.Result aiResult = aiPrecheckService.precheck(request);
        String packageSnapshot = packageUploadService.consumeForSubmission(actor, request.extensionType(), request.extensionId(),
                request.version(), request.uploadRefs());
        Integer nextRevision = jdbc.queryForObject("""
                select coalesce(max(revision_no), 0) + 1 from submission_revisions where submission_id = ?
                """, Integer.class, submissionId);
        UUID revisionId = UUID.randomUUID();
        jdbc.update("""
                insert into submission_revisions (id, submission_id, revision_no, payload_snapshot, package_snapshot, submitted_by)
                values (?, ?, ?, ?::jsonb, ?::jsonb, ?)
                """, revisionId, submissionId, nextRevision, snapshots.envelope("submission", payload(request)),
                packageSnapshot, actor.id());
        jdbc.update("update submissions set status = 'PENDING_REVIEW', current_revision_id = ?, updated_at = now() where id = ?",
                revisionId, submissionId);
        jdbc.update("""
                insert into system_prechecks (id, submission_id, revision_id, rule_status, rule_result,
                  ai_status, ai_result_summary, ai_model, ai_prompt_version)
                values (?, ?, ?, 'PASSED', ?::jsonb, ?, ?::jsonb, ?, ?)
                """, UUID.randomUUID(), submissionId, revisionId,
                snapshots.envelope("precheck", Map.of("status", "PASSED", "summary", "规则预审通过")),
                aiResult.status(), snapshots.envelope("precheck", aiResult.summary()), aiResult.model(), aiResult.promptVersion());
        audit(actor, "submission.revise", submissionId, String.valueOf(submission.get("target_extension_id")),
                Map.of("revisionNo", nextRevision));
        insertReviewerNotificationOutbox(submissionId, String.valueOf(submission.get("target_extension_id")),
                String.valueOf(submission.get("review_owner_type")), (UUID) submission.get("review_owner_department_id"));
        return Map.of("submissionId", submissionId, "revisionId", revisionId, "revisionNo", nextRevision,
                "status", "PENDING_REVIEW", "displayStatus", "待审核");
    }

    public Map<String, Object> requireVisibleSubmission(CurrentUser actor, UUID submissionId) {
        Map<String, Object> submission = requireSubmission(submissionId);
        if (!actor.id().equals(submission.get("submitter_id")) && !canManageSubmission(actor, submission)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权查看申请");
        }
        return submission;
    }

    public Map<String, Object> requireSubmission(UUID submissionId) {
        var rows = jdbc.queryForList("select * from submissions where id = ?", submissionId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "申请不存在");
        }
        return rows.get(0);
    }

    public Map<String, Object> detail(Map<String, Object> submission) {
        Map<String, Object> detail = new LinkedHashMap<>(submissionSummary(submission));
        var revisions = jdbc.queryForList("""
                select id, revision_no, payload_snapshot::text as payload_snapshot, package_snapshot::text as package_snapshot,
                  submitted_by, created_at from submission_revisions where submission_id = ? order by revision_no desc
                """, submission.get("id")).stream().map(row -> {
                    Map<String, Object> item = new LinkedHashMap<>(row);
                    item.put("payloadSnapshot", json.read((String) row.get("payload_snapshot")));
                    item.put("packageSnapshot", json.read((String) row.get("package_snapshot")));
                    item.remove("payload_snapshot");
                    item.remove("package_snapshot");
                    return item;
                }).toList();
        var prechecks = jdbc.queryForList("""
                select id, revision_id, rule_status, rule_result::text as rule_result, ai_status,
                  ai_result_summary::text as ai_result_summary, ai_model, ai_prompt_version, created_at
                from system_prechecks where submission_id = ? order by created_at desc
                """, submission.get("id")).stream().map(row -> {
                    Map<String, Object> item = new LinkedHashMap<>(row);
                    item.put("ruleResult", json.read((String) row.get("rule_result")));
                    item.put("aiResultSummary", json.read((String) row.get("ai_result_summary")));
                    item.remove("rule_result");
                    item.remove("ai_result_summary");
                    return item;
                }).toList();
        detail.put("revisions", revisions);
        detail.put("prechecks", prechecks);
        return detail;
    }

    private Map<String, Object> submissionSummary(Map<String, Object> row) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("submissionId", row.get("id"));
        item.put("type", row.get("type"));
        item.put("extensionType", row.get("extension_type"));
        item.put("extensionId", row.get("target_extension_id"));
        item.put("submitterId", row.get("submitter_id"));
        item.put("status", row.get("status"));
        item.put("reviewOwnerType", row.get("review_owner_type"));
        item.put("reviewOwnerDepartmentId", row.get("review_owner_department_id"));
        item.put("currentRevisionId", row.get("current_revision_id"));
        item.put("effectiveRevisionId", row.get("effective_revision_id"));
        item.put("createdAt", row.get("created_at"));
        item.put("updatedAt", row.get("updated_at"));
        return item;
    }

    private Map<String, Object> payload(SubmissionRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", request.type().name());
        payload.put("extensionType", request.extensionType().name());
        payload.put("extensionId", request.extensionId());
        payload.put("baseExtensionId", request.baseExtensionId());
        payload.put("version", request.version());
        payload.put("metadata", request.metadata() == null ? Map.of() : request.metadata());
        payload.put("authorizationScope", request.authorizationScope() == null ? Map.of() : request.authorizationScope());
        payload.put("visibilityMode", request.visibilityMode() == null ? "PUBLIC_TO_ALL_LOGGED_IN" : request.visibilityMode().name());
        payload.put("riskStatement", request.riskStatement() == null ? Map.of() : request.riskStatement());
        payload.put("typePayload", request.typePayload() == null ? Map.of() : request.typePayload());
        return payload;
    }

    private String ownerType(SubmissionRequest request) {
        Object scope = request.authorizationScope() == null ? null : request.authorizationScope().get("scopeType");
        if (ScopeType.ALL_EMPLOYEES.name().equals(String.valueOf(scope))) {
            return "SYSTEM_ADMIN";
        }
        return "DEPARTMENT_ADMIN";
    }

    private boolean canManageSubmission(CurrentUser actor, Map<String, Object> submission) {
        if (actor.isSystemAdmin()) {
            return true;
        }
        if (!actor.isDepartmentAdmin() || !"DEPARTMENT_ADMIN".equals(String.valueOf(submission.get("review_owner_type")))) {
            return false;
        }
        Object ownerDepartment = submission.get("review_owner_department_id");
        return ownerDepartment instanceof UUID departmentId
                && departmentTreeService.isSelfOrDescendant(actor.departmentId(), departmentId);
    }


    private void insertReviewerNotificationOutbox(UUID submissionId, String extensionId, String ownerType, UUID ownerDepartmentId) {
        for (UUID reviewerId : reviewerIds(ownerType, ownerDepartmentId)) {
            Map<String, Object> notification = new LinkedHashMap<>();
            notification.put("userId", reviewerId.toString());
            notification.put("type", "REVIEW_TASK_ASSIGNED");
            notification.put("title", "新的发布申请待审核");
            notification.put("summary", "申请 " + extensionId + " 等待审核");
            notification.put("objectType", "submission");
            notification.put("objectId", submissionId.toString());
            notification.put("status", "PENDING_REVIEW");
            jdbc.update("""
                    insert into outbox_events (id, event_type, aggregate_type, aggregate_id, payload, status, retry_count)
                    values (?, 'NOTIFICATION_REQUESTED', 'submission', ?, ?::jsonb, 'NEW', 0)
                    """, UUID.randomUUID(), submissionId, snapshots.envelope("notification", notification));
        }
    }

    private List<UUID> reviewerIds(String ownerType, UUID ownerDepartmentId) {
        if ("DEPARTMENT_ADMIN".equals(ownerType) && ownerDepartmentId != null) {
            UUID cursor = ownerDepartmentId;
            while (cursor != null) {
                List<UUID> departmentAdmins = activeAdmins("DEPARTMENT_ADMIN", cursor);
                if (!departmentAdmins.isEmpty()) {
                    return departmentAdmins;
                }
                cursor = parentDepartmentId(cursor);
            }
        }
        return activeAdmins("SYSTEM_ADMIN", null);
    }

    private List<UUID> activeAdmins(String role, UUID departmentId) {
        if (departmentId == null) {
            return jdbc.queryForList("""
                    select id from users where role = ? and status = 'ACTIVE'
                    """, role).stream()
                    .map(row -> (UUID) row.get("id"))
                    .toList();
        }
        return jdbc.queryForList("""
                select id from users where role = ? and status = 'ACTIVE' and department_id = ?
                """, role, departmentId).stream()
                .map(row -> (UUID) row.get("id"))
                .toList();
    }

    private UUID parentDepartmentId(UUID departmentId) {
        var rows = jdbc.queryForList("select parent_id from departments where id = ?", departmentId);
        if (rows.isEmpty()) {
            return null;
        }
        return (UUID) rows.get(0).get("parent_id");
    }

    private void audit(CurrentUser actor, String action, UUID submissionId, String objectName, Map<String, Object> after) {
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(Map.of("name", actor.name(), "role", actor.role().name()))
                .actorDepartmentSnapshot(Map.of("departmentId", actor.departmentId().toString(), "departmentName", actor.departmentName()))
                .objectType("submission")
                .objectId(submissionId.toString())
                .objectNameSnapshot(objectName)
                .action(action)
                .result(AuditResult.SUCCESS)
                .afterSummary(snapshots.envelopeMap("audit", after))
                .build());
    }
}
