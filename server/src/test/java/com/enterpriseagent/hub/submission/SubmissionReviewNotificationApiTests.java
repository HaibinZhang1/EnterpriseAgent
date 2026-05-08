package com.enterpriseagent.hub.submission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
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
        String body = submissionBody("first-skill-" + uniqueDigits(), "{}", "[]");

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
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
                """, String.class, UUID.fromString(submissionId))).isEqualTo("NOT_IMPLEMENTED_IN_M4");
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
                        .content(submissionBody(extensionId, "{}", "[]")))
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
    void departmentAdminCanOnlyReadSubmissionsInManagementScope() throws Exception {
        Department ownerDepartment = departmentRepository.save(new Department("owner" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        Department otherDepartment = departmentRepository.save(new Department("other" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER, ownerDepartment.getId());
        User ownerAdmin = createUser("136" + uniqueDigits(), Role.DEPARTMENT_ADMIN, ownerDepartment.getId());
        User otherAdmin = createUser("136" + uniqueDigits(), Role.DEPARTMENT_ADMIN, otherDepartment.getId());
        String submitterToken = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String ownerAdminToken = login(ownerAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String otherAdminToken = login(otherAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String body = submissionBody("scope-skill-" + uniqueDigits(), "{}", "[]")
                .replace("\"scopeType\":\"ALL_EMPLOYEES\"", "\"scopeType\":\"DEPARTMENT\"");
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
    void checklistCompatibilityAliasesSupportMineResubmitAndSplitReviewDecisions() throws Exception {
        User submitter = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String submitterToken = login(submitter.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String extensionId = "alias-review-skill-" + uniqueDigits();
        String create = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + submitterToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId, "{}", "[]")))
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
                        .content(submissionBody(extensionId, "{}", "[]")))
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

    private String uniqueDigits() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
