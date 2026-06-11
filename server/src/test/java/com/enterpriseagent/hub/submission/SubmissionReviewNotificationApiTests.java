package com.enterpriseagent.hub.submission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;
import com.enterpriseagent.hub.auth.PasswordService;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.notification.NotificationOutboxConsumer;
import com.enterpriseagent.hub.organization.Department;
import com.enterpriseagent.hub.organization.DepartmentRepository;

@AutoConfigureMockMvc
class SubmissionReviewNotificationApiTests extends PostgresIntegrationTestBase {
    private static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private NotificationOutboxConsumer outboxConsumer;
    @Autowired
    private DepartmentRepository departmentRepository;

    @Test
    void submissionCreateUsesIdempotencyAndRejectsPackageStorageFields() throws Exception {
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String token = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String extensionId = "first-skill-" + uniqueDigits();
        String missingPackageBody = submissionBody(extensionId, "{}", "[]");

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(missingPackageBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String body = submissionBody(extensionId, "{}", uploadRefs(token, extensionId));
        String key = UUID.randomUUID().toString();
        String first = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING_REVIEW"))
                .andReturn().getResponse().getContentAsString();
        String submissionId = extract(first, "submissionId");
        assertThat(jdbc.queryForObject("""
                select package_snapshot #>> '{data,packageStorageStatus}'
                from submission_revisions where submission_id = ?
                """, String.class, UUID.fromString(submissionId))).isEqualTo("CONSUMED");
        assertThat(jdbc.queryForObject("""
                select after_summary->>'schemaVersion' from audit_logs
                where action = 'submission.create' and object_id = ?
                order by created_at desc limit 1
                """, String.class, submissionId)).isEqualTo("1");
        assertThat(jdbc.queryForObject("""
                select count(*) from outbox_events
                where aggregate_id = ? and event_type = 'NOTIFICATION_REQUESTED' and status = 'DONE'
                """, Long.class, UUID.fromString(submissionId))).isEqualTo(1L);
        String reviewerNotifications = mockMvc.perform(get("/api/notifications").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(reviewerNotifications).contains("REVIEW_TASK_ASSIGNED", submissionId);

        String replay = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(extract(replay, "submissionId")).isEqualTo(submissionId);
        assertThat(jdbc.queryForObject("select count(*) from submissions where id = ?", Long.class,
                UUID.fromString(submissionId))).isEqualTo(1L);

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.replace("FIRST_PUBLISH", "METADATA_CHANGE")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("idempotency_conflict"));

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody("bad-package-" + uniqueDigits(), "{\"objectStoreKey\":\"pkg/key\"}", "[]")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody("bad-upload-" + uniqueDigits(), "{}", "[{\"tempUploadId\":\"tmp\"}]")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
        for (String forbiddenPayload : new String[] {
                "{\"uploadUrl\":\"https://example.invalid/pkg.zip\"}",
                "{\"packageUrl\":\"https://example.invalid/pkg.zip\"}",
                "{\"object_store\":\"s3://bucket/pkg.zip\"}",
                "{\"objectStorageKey\":\"s3://bucket/pkg.zip\"}",
                "{\"download_tickets\":[\"dt_1\"]}",
                "{\"credentials\":{\"token\":\"secret\"}}",
                "{\"apiKey\":\"secret\"}",
                "{\"secret\":\"secret\"}",
                "{\"password\":\"secret\"}",
                "{\"downloadToken\":\"secret\"}"
        }) {
            mockMvc.perform(post("/api/submissions")
                            .header("Authorization", "Bearer " + token)
                            .header("Idempotency-Key", UUID.randomUUID().toString())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(submissionBody("bad-boundary-" + uniqueDigits(), forbiddenPayload, "[]")))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("validation_failed"));
        }
    }

    @Test
    void submissionCreationRequiresExplicitAuthorizationScopeAndVisibility() throws Exception {
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String token = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String extensionId = "fail-closed-scope-" + uniqueDigits();
        String uploadRefs = uploadRefs(token, extensionId);

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId, "{}", uploadRefs)
                                .replace("  \"authorizationScope\":{\"scopeType\":\"ALL_EMPLOYEES\",\"departments\":[]},\n", "")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId + "-missing-type", "{}", uploadRefs(token, extensionId + "-missing-type"))
                                .replace("{\"scopeType\":\"ALL_EMPLOYEES\",\"departments\":[]}", "{\"departments\":[]}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId + "-missing-visibility", "{}", uploadRefs(token, extensionId + "-missing-visibility"))
                                .replace("  \"visibilityMode\":\"PUBLIC_TO_ALL_LOGGED_IN\",\n", "")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId + "-bad-dept", "{}", uploadRefs(token, extensionId + "-bad-dept"))
                                .replace("{\"scopeType\":\"ALL_EMPLOYEES\",\"departments\":[]}",
                                        "{\"scopeType\":\"SELECTED_DEPARTMENTS\",\"departments\":[]}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void approvalFailsForHistoricalRevisionMissingScopeOrVisibility() throws Exception {
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String submitterToken = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");

        String missingScopeCreate = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody("legacy-missing-scope-" + uniqueDigits(), "{}",
                                uploadRefs(submitterToken, "legacy-missing-scope-" + uniqueDigits()))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String missingScopeSubmissionId = extract(missingScopeCreate, "submissionId");
        String missingScopeRevisionId = extract(missingScopeCreate, "revisionId");
        jdbc.update("""
                update submission_revisions
                   set payload_snapshot = jsonb_set(payload_snapshot, '{data}', (payload_snapshot->'data') - 'authorizationScope')
                 where id = ?
                """, UUID.fromString(missingScopeRevisionId));
        mockMvc.perform(post("/api/reviews/tasks/" + missingScopeSubmissionId + "/decision")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + missingScopeRevisionId + "\",\"decision\":\"APPROVE\",\"comment\":\"legacy\",\"reasonCodes\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        String missingVisibilityExtensionId = "legacy-missing-visibility-" + uniqueDigits();
        String missingVisibilityCreate = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(missingVisibilityExtensionId, "{}",
                                uploadRefs(submitterToken, missingVisibilityExtensionId))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String missingVisibilitySubmissionId = extract(missingVisibilityCreate, "submissionId");
        String missingVisibilityRevisionId = extract(missingVisibilityCreate, "revisionId");
        jdbc.update("""
                update submission_revisions
                   set payload_snapshot = jsonb_set(payload_snapshot, '{data}', (payload_snapshot->'data') - 'visibilityMode')
                 where id = ?
                """, UUID.fromString(missingVisibilityRevisionId));
        mockMvc.perform(post("/api/reviews/tasks/" + missingVisibilitySubmissionId + "/decision")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + missingVisibilityRevisionId + "\",\"decision\":\"APPROVE\",\"comment\":\"legacy\",\"reasonCodes\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void aiPrecheckFailurePolicyIsVisibleAndFailClosed() throws Exception {
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String token = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        try {
            jdbc.update("delete from settings where key = 'ai.precheck'");
            jdbc.update("insert into settings (key, value, version) values ('ai.precheck', '\"broken\"'::jsonb, 1)");
            mockMvc.perform(post("/api/submissions")
                            .header("Authorization", "Bearer " + token)
                            .header("Idempotency-Key", UUID.randomUUID().toString())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(submissionBody("ai-config-broken-" + uniqueDigits(), "{}",
                                    uploadRefs(token, "ai-config-broken-" + uniqueDigits()))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("validation_failed"));

            jdbc.update("delete from settings where key = 'ai.precheck'");
            jdbc.update("insert into settings (key, value, version) values ('ai.precheck', '{\"enabled\":true}'::jsonb, 1)");
            mockMvc.perform(post("/api/submissions")
                            .header("Authorization", "Bearer " + token)
                            .header("Idempotency-Key", UUID.randomUUID().toString())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(submissionBody("ai-config-missing-policy-" + uniqueDigits(), "{}",
                                    uploadRefs(token, "ai-config-missing-policy-" + uniqueDigits()))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("validation_failed"));

            jdbc.update("delete from settings where key = 'ai.precheck'");
            jdbc.update("""
                    insert into settings (key, value, version)
                    values ('ai.precheck', '{"enabled":true,"failurePolicy":"FAIL_CLOSED","promptVersion":"test"}'::jsonb, 1)
                    """);
            mockMvc.perform(post("/api/submissions")
                            .header("Authorization", "Bearer " + token)
                            .header("Idempotency-Key", UUID.randomUUID().toString())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(submissionBody("ai-fail-closed-" + uniqueDigits(), "{}",
                                    uploadRefs(token, "ai-fail-closed-" + uniqueDigits()))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("validation_failed"));

            jdbc.update("delete from settings where key = 'ai.precheck'");
            jdbc.update("""
                    insert into settings (key, value, version)
                    values ('ai.precheck', '{"enabled":true,"failurePolicy":"CONTINUE_WITH_UNAVAILABLE","promptVersion":"test"}'::jsonb, 1)
                    """);
            String extensionId = "ai-unavailable-" + uniqueDigits();
            String create = mockMvc.perform(post("/api/submissions")
                            .header("Authorization", "Bearer " + token)
                            .header("Idempotency-Key", UUID.randomUUID().toString())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(submissionBody(extensionId, "{}", uploadRefs(token, extensionId))))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            assertThat(jdbc.queryForObject("""
                    select ai_status from system_prechecks where submission_id = ?
                    """, String.class, UUID.fromString(extract(create, "submissionId")))).isEqualTo("UNAVAILABLE");

            jdbc.update("delete from settings where key = 'ai.precheck'");
            mockMvc.perform(post("/api/submissions")
                            .header("Authorization", "Bearer " + token)
                            .header("Idempotency-Key", UUID.randomUUID().toString())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(submissionBody("ai-config-missing-row-" + uniqueDigits(), "{}",
                                    uploadRefs(token, "ai-config-missing-row-" + uniqueDigits()))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("validation_failed"));
        } finally {
            restoreDefaultAiPrecheckSettings();
        }
    }

    @Test
    void reviewDecisionWritesAuditOutboxMaterializesExtensionAndCreatesOwnedNotification() throws Exception {
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String submitterToken = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String normalToken = submitterToken;
        String extensionId = "review-skill-" + uniqueDigits();
        String create = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId, "{}", uploadRefs(submitterToken, extensionId))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String submissionId = extract(create, "submissionId");
        String revisionId = extract(create, "revisionId");

        mockMvc.perform(get("/api/reviews/tasks").header("Authorization", "Bearer " + normalToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));

        mockMvc.perform(post("/api/reviews/tasks/" + submissionId + "/decision")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + revisionId + "\",\"decision\":\"APPROVE\",\"comment\":\"ok\",\"reasonCodes\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        String decisionKey = UUID.randomUUID().toString();
        mockMvc.perform(post("/api/reviews/tasks/" + submissionId + "/decision")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", decisionKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + revisionId + "\",\"decision\":\"APPROVE\",\"comment\":\"ok\",\"reasonCodes\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("APPROVED"));

        assertThat(jdbc.queryForObject("select count(*) from extensions where extension_id = ?", Long.class, extensionId))
                .isEqualTo(1L);
        assertThat(jdbc.queryForObject("select count(*) from audit_logs where action = 'review.decision'", Long.class))
                .isGreaterThan(0L);
        assertThat(jdbc.queryForObject("""
                select before_summary->>'schemaVersion' from audit_logs
                where action = 'review.decision' and object_id = ?
                order by created_at desc limit 1
                """, String.class, submissionId)).isEqualTo("1");
        assertThat(jdbc.queryForObject("select count(*) from outbox_events where aggregate_id = ? and status = 'DONE'", Long.class,
                UUID.fromString(submissionId))).isGreaterThanOrEqualTo(2L);

        String notifications = mockMvc.perform(get("/api/notifications").header("Authorization", "Bearer " + submitterToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].objectId").value(submissionId))
                .andReturn().getResponse().getContentAsString();
        String notificationId = extract(notifications, "id");
        User other = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String otherToken = login(other.getPhone(), "Temp#123456", "DESKTOP");
        mockMvc.perform(post("/api/notifications/" + notificationId + "/read")
                        .header("Authorization", "Bearer " + otherToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("resource_not_found"));
        mockMvc.perform(post("/api/notifications/" + notificationId + "/read")
                        .header("Authorization", "Bearer " + submitterToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.readAt").exists());
    }

    @Test
    void notificationOutboxConsumerRecordsFailureWithoutThrowing() {
        UUID eventId = UUID.randomUUID();
        jdbc.update("""
                insert into outbox_events (id, event_type, aggregate_type, aggregate_id, payload, status, retry_count)
                values (?, 'NOTIFICATION_REQUESTED', 'submission', ?, ?::jsonb, 'NEW', 0)
                """, eventId, UUID.randomUUID(), """
                {"schemaVersion":1,"capturedAt":"2026-05-08T00:00:00Z","source":"notification","data":{"userId":"not-a-uuid"}}
                """);

        outboxConsumer.processPending();

        assertThat(jdbc.queryForObject("select status from outbox_events where id = ?", String.class, eventId))
                .isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("select retry_count from outbox_events where id = ?", Integer.class, eventId))
                .isEqualTo(1);
    }

    @Test
    void notificationOutboxRequiresCorePayloadFields() {
        UUID eventId = UUID.randomUUID();
        jdbc.update("""
                insert into outbox_events (id, event_type, aggregate_type, aggregate_id, payload, status, retry_count)
                values (?, 'NOTIFICATION_REQUESTED', 'submission', ?, ?::jsonb, 'NEW', 0)
                """, eventId, UUID.randomUUID(), """
                {"schemaVersion":1,"capturedAt":"2026-05-08T00:00:00Z","source":"notification","data":{"userId":"00000000-0000-0000-0000-000000000001","type":"REVIEW_DECISION"}}
                """);

        outboxConsumer.processPending();

        assertThat(jdbc.queryForObject("select status from outbox_events where id = ?", String.class, eventId))
                .isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("select last_error from outbox_events where id = ?", String.class, eventId))
                .contains("notification payload");
        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id = ?",
                Long.class, UUID.fromString("00000000-0000-0000-0000-000000000001"))).isZero();
    }

    @Test
    void notificationOutboxDeadLettersPoisonPayloadAfterRetryLimit() {
        UUID eventId = UUID.randomUUID();
        UUID userId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        jdbc.update("""
                insert into outbox_events (id, event_type, aggregate_type, aggregate_id, payload, status, retry_count, next_retry_at)
                values (?, 'NOTIFICATION_REQUESTED', 'submission', ?, ?::jsonb, 'FAILED', 2, now() - interval '1 minute')
                """, eventId, UUID.randomUUID(), """
                {"schemaVersion":1,"capturedAt":"2026-05-08T00:00:00Z","source":"notification","data":{"userId":"00000000-0000-0000-0000-000000000001","type":"REVIEW_DECISION"}}
                """);

        outboxConsumer.processPending();

        assertThat(jdbc.queryForObject("select status from outbox_events where id = ?", String.class, eventId))
                .isEqualTo("DEAD_LETTER");
        assertThat(jdbc.queryForObject("select retry_count from outbox_events where id = ?", Integer.class, eventId))
                .isEqualTo(3);
        assertThat(jdbc.queryForObject("select next_retry_at from outbox_events where id = ?", Object.class, eventId))
                .isNull();
        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id = ?", Long.class, userId))
                .isZero();
    }

    @Test
    void departmentAdminCanOnlyReadSubmissionsInManagementScope() throws Exception {
        Department ownerDepartment = departmentRepository.save(new Department("owner" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        Department otherDepartment = departmentRepository.save(new Department("other" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER, ownerDepartment.getId());
        User ownerAdmin = createUser("136" + uniqueDigits(), Role.DEPARTMENT_ADMIN, ownerDepartment.getId());
        User otherAdmin = createUser("136" + uniqueDigits(), Role.DEPARTMENT_ADMIN, otherDepartment.getId());
        String submitterToken = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String ownerAdminToken = login(ownerAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String otherAdminToken = login(otherAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String scopeExtensionId = "scope-skill-" + uniqueDigits();
        String ownerScope = """
                {"scopeType":"DEPARTMENT","departments":[{"departmentId":"%s","includeChildren":true}]}
                """.formatted(ownerDepartment.getId());
        String body = submissionBody(scopeExtensionId, "{}", uploadRefs(submitterToken, scopeExtensionId))
                .replace("{\"scopeType\":\"ALL_EMPLOYEES\",\"departments\":[]}", ownerScope);
        String create = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String submissionId = extract(create, "submissionId");

        mockMvc.perform(get("/api/submissions/" + submissionId).header("Authorization", "Bearer " + ownerAdminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.submissionId").value(submissionId));
        mockMvc.perform(get("/api/submissions/" + submissionId).header("Authorization", "Bearer " + otherAdminToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
    }

    @Test
    void crossDepartmentAuthorizationScopeRoutesToSystemReview() throws Exception {
        Department ownerDepartment = departmentRepository.save(new Department("owner" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        Department otherDepartment = departmentRepository.save(new Department("other" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER, ownerDepartment.getId());
        User ownerAdmin = createUser("136" + uniqueDigits(), Role.DEPARTMENT_ADMIN, ownerDepartment.getId());
        String submitterToken = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String ownerAdminToken = login(ownerAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String systemAdminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String extensionId = "cross-scope-skill-" + uniqueDigits();
        String scope = """
                {"scopeType":"SELECTED_DEPARTMENTS","departments":[{"departmentId":"%s","includeChildren":false}]}
                """.formatted(otherDepartment.getId());
        String body = submissionBody(extensionId, "{}", uploadRefs(submitterToken, extensionId))
                .replace("{\"scopeType\":\"ALL_EMPLOYEES\",\"departments\":[]}", scope);
        String create = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String submissionId = extract(create, "submissionId");

        assertThat(jdbc.queryForObject("select review_owner_type from submissions where id = ?",
                String.class, UUID.fromString(submissionId))).isEqualTo("SYSTEM_ADMIN");
        mockMvc.perform(get("/api/reviews/tasks/" + submissionId).header("Authorization", "Bearer " + ownerAdminToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
        String ownerTasks = mockMvc.perform(get("/api/reviews/tasks")
                        .header("Authorization", "Bearer " + ownerAdminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(ownerTasks).doesNotContain(submissionId);
        String systemTasks = mockMvc.perform(get("/api/reviews/tasks")
                        .header("Authorization", "Bearer " + systemAdminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(systemTasks).contains(submissionId);
    }

    @Test
    void reviewTasksFilterAndSortBeforePaginationWithSubmitterSummary() throws Exception {
        User firstSubmitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        User secondSubmitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String firstToken = login(firstSubmitter.getPhone(), "Temp#123456", "DESKTOP");
        String secondToken = login(secondSubmitter.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String group = "review-filter-" + uniqueDigits();
        String olderExtension = group + "-older";
        String newerExtension = group + "-newer";

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + firstToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(olderExtension, "{}", uploadRefs(firstToken, olderExtension))))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + secondToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(newerExtension, "{}", uploadRefs(secondToken, newerExtension))))
                .andExpect(status().isOk());
        jdbc.update("update submissions set created_at = now() - interval '2 hours' where target_extension_id = ?",
                olderExtension);
        jdbc.update("update submissions set created_at = now() - interval '1 hour' where target_extension_id = ?",
                newerExtension);

        mockMvc.perform(get("/api/reviews/tasks")
                        .param("status", "PENDING")
                        .param("keyword", group)
                        .param("sort", "submitted_asc")
                        .param("pageSize", "1")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.items[0].extensionId").value(olderExtension))
                .andExpect(jsonPath("$.data.items[0].submitterName").value(firstSubmitter.getName()));
        mockMvc.perform(get("/api/reviews/tasks")
                        .param("status", "PENDING")
                        .param("keyword", group)
                        .param("sort", "submitted_desc")
                        .param("pageSize", "1")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].extensionId").value(newerExtension));
        mockMvc.perform(get("/api/reviews/tasks")
                        .param("status", "PENDING")
                        .param("keyword", group)
                        .param("submitter", firstSubmitter.getName())
                        .param("pageSize", "1")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].extensionId").value(olderExtension));
        mockMvc.perform(get("/api/reviews/tasks")
                        .param("status", "PENDING")
                        .param("keyword", group)
                        .param("type", "PLUGIN")
                        .param("pageSize", "1")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
    }


    @Test
    void checklistCompatibilityAliasesSupportMineResubmitAndSplitReviewDecisions() throws Exception {
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String submitterToken = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String extensionId = "alias-review-skill-" + uniqueDigits();
        String create = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId, "{}", uploadRefs(submitterToken, extensionId))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String submissionId = extract(create, "submissionId");
        String revisionId = extract(create, "revisionId");

        mockMvc.perform(get("/api/submissions/my").header("Authorization", "Bearer " + submitterToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].submissionId").value(submissionId));
        mockMvc.perform(post("/api/reviews/tasks/" + submissionId + "/request-changes")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + revisionId + "\",\"comment\":\"fix docs\",\"reasonCodes\":[\"metadata\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("CHANGES_REQUESTED"));

        String resubmit = mockMvc.perform(post("/api/submissions/" + submissionId + "/resubmit")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId, "{}", uploadRefs(submitterToken, extensionId + "-resubmit"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.revisionNo").value(2))
                .andReturn().getResponse().getContentAsString();
        String secondRevisionId = extract(resubmit, "revisionId");
        assertThat(jdbc.queryForObject("select count(*) from submission_revisions where submission_id = ?", Long.class,
                UUID.fromString(submissionId))).isEqualTo(2L);
        assertThat(jdbc.queryForObject("""
                select count(*) from outbox_events
                where aggregate_id = ? and status = 'DONE'
                  and payload #>> '{data,type}' = 'REVIEW_TASK_ASSIGNED'
                """, Long.class, UUID.fromString(submissionId))).isEqualTo(2L);
        String reviewerNotifications = mockMvc.perform(get("/api/notifications").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(reviewerNotifications).contains("REVIEW_TASK_ASSIGNED", submissionId);

        mockMvc.perform(post("/api/reviews/tasks/" + submissionId + "/reject")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + secondRevisionId + "\",\"comment\":\"not ready\",\"reasonCodes\":[\"quality\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("REJECTED"));
        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id = ?", Long.class, submitter.getId()))
                .isGreaterThanOrEqualTo(2L);
    }

    private User createUser(String phone, Role role) {
        return createUser(phone, role, ROOT_DEPARTMENT_ID);
    }


    private User createUser(String phone, Role role, UUID departmentId) {
        User user = new User("测试用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode("Temp#123456"), PasswordService.ALGORITHM, departmentId, role);
        user.setMustChangePassword(false);
        return userRepository.save(user);
    }

    private String submissionBody(String extensionId, String typePayload, String uploadRefs) {
        return """
                {
                  "type":"FIRST_PUBLISH",
                  "extensionType":"SKILL",
                  "extensionId":"%s",
                  "version":"1.0.0",
                  "metadata":{"name":"%s","description":"desc","category":"dev","tags":["test"],"changeLog":"init"},
                  "authorizationScope":{"scopeType":"ALL_EMPLOYEES","departments":[]},
                  "visibilityMode":"PUBLIC_TO_ALL_LOGGED_IN",
                  "riskStatement":{"summary":"low"},
                  "typePayload":%s,
                  "uploadRefs":%s
                }
                """.formatted(extensionId, extensionId, typePayload, uploadRefs);
    }

    private String uploadRefs(String token, String name) throws Exception {
        byte[] zip = zip(entry("SKILL.md", "---\nname: " + name + "\n---\n# " + name));
        String uploadResponse = mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", name + ".zip", "application/zip", zip))
                        .param("uploadType", "SKILL_PACKAGE")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return "[{\"tempUploadId\":\"" + extract(uploadResponse, "tempUploadId")
                + "\",\"sha256\":\"" + extract(uploadResponse, "sha256") + "\"}]";
    }

    private byte[] zip(ZipContent... contents) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            for (ZipContent content : contents) {
                out.putNextEntry(new ZipEntry(content.name()));
                out.write(content.content().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private ZipContent entry(String name, String content) {
        return new ZipContent(name, content);
    }

    private String login(String phone, String password, String clientType) throws Exception {
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"" + password + "\",\"clientType\":\"" + clientType + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return response.replaceAll(".*\"token\":\"([^\"]+)\".*", "$1");
    }

    private String extract(String response, String field) throws Exception {
        JsonNode root = new ObjectMapper().readTree(response);
        JsonNode data = root.path("data");
        if (data.has(field)) {
            return data.path(field).asText();
        }
        JsonNode items = data.path("items");
        if (items.isArray() && !items.isEmpty() && items.get(0).has(field)) {
            return items.get(0).path(field).asText();
        }
        throw new IllegalArgumentException("Field not found in response: " + field);
    }

    private void restoreDefaultAiPrecheckSettings() {
        jdbc.update("""
                insert into settings (key, value, version)
                values ('ai.precheck',
                  '{"enabled":false,"failurePolicy":"CONTINUE_WITH_UNAVAILABLE","timeoutMs":30000,"promptVersion":"m4-default"}'::jsonb,
                  1)
                on conflict (key) do update set value = excluded.value, version = settings.version + 1
                """);
    }

    private String uniqueDigits() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    private record ZipContent(String name, String content) {}
}
