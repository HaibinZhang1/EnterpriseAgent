package com.enterpriseagent.hub.extension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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

import com.enterpriseagent.hub.PostgresIntegrationTestBase;
import com.enterpriseagent.hub.auth.PasswordService;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.organization.Department;
import com.enterpriseagent.hub.organization.DepartmentRepository;

@AutoConfigureMockMvc
class ExtensionCatalogApiTests extends PostgresIntegrationTestBase {
    private static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private DepartmentRepository departmentRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void communityHomeSearchAndDetailFilterAuthorizedOnlyExtensions() throws Exception {
        User user = createUser("137" + uniqueDigits(), ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        Department restrictedDepartment = departmentRepository.save(new Department("restricted" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        createPublished("public-skill-" + uniqueDigits(), ExtensionType.SKILL, "Public Skill",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, ROOT_DEPARTMENT_ID, user.getId(), ScopeType.ALL_EMPLOYEES);
        String restrictedId = "restricted-skill-" + uniqueDigits();
        createPublished(restrictedId, ExtensionType.SKILL, "Restricted Skill",
                VisibilityMode.AUTHORIZED_ONLY, restrictedDepartment.getId(), adminId(), ScopeType.SELECTED_DEPARTMENTS);

        String home = mockMvc.perform(get("/api/extensions/community/home")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.skill.hot[0].extensionId").exists())
                .andReturn().getResponse().getContentAsString();
        assertThat(home).doesNotContain(restrictedId);

        String search = mockMvc.perform(get("/api/extensions/search")
                        .header("Authorization", "Bearer " + token)
                        .param("q", "Skill"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(search).contains("Public Skill").doesNotContain(restrictedId);

        mockMvc.perform(get("/api/extensions/" + restrictedId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
    }

    @Test
    void publicVisibleRestrictedExtensionsAreVisibleButNotAuthorizedForMainOperations() throws Exception {
        User user = createUser("137" + uniqueDigits(), ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        Department authorizedDepartment = departmentRepository.save(new Department("authorized" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        String extensionId = "public-restricted-" + uniqueDigits();
        createPublished(extensionId, ExtensionType.SKILL, "Public Restricted Skill",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, authorizedDepartment.getId(), adminId(), ScopeType.SELECTED_DEPARTMENTS);

        mockMvc.perform(get("/api/extensions/search")
                        .header("Authorization", "Bearer " + token)
                        .param("q", extensionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].extensionId").value(extensionId))
                .andExpect(jsonPath("$.data.items[0].authorized").value(false))
                .andExpect(jsonPath("$.data.items[0].mainOperationDeniedReason").value("scope_restricted"));
        mockMvc.perform(get("/api/extensions/" + extensionId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.authorized").value(false))
                .andExpect(jsonPath("$.data.mainOperationDeniedReason").value("scope_restricted"));
    }

    @Test
    void starOperationIsIdempotentAndAdminRoutesAreSeparated() throws Exception {
        User user = createUser("137" + uniqueDigits(), ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        String normalToken = login(user.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String extensionId = "star-skill-" + uniqueDigits();
        createPublished(extensionId, ExtensionType.SKILL, "Star Skill",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, ROOT_DEPARTMENT_ID, user.getId(), ScopeType.ALL_EMPLOYEES);

        mockMvc.perform(post("/api/extensions/" + extensionId + "/star")
                        .header("Authorization", "Bearer " + normalToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"starred\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.starCount").value(1));
        mockMvc.perform(post("/api/extensions/" + extensionId + "/star")
                        .header("Authorization", "Bearer " + normalToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"starred\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.starCount").value(1));
        mockMvc.perform(post("/api/extensions/" + extensionId + "/star")
                        .header("Authorization", "Bearer " + normalToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"starred\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.starCount").value(0));

        mockMvc.perform(get("/api/admin/extensions").header("Authorization", "Bearer " + normalToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
        mockMvc.perform(get("/api/admin/extensions/" + extensionId).header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.governance.adminVisible").value(true));
        mockMvc.perform(get("/api/admin/extensions/" + extensionId + "/versions").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].version").value("1.0.0"));
    }

    @Test
    void adminExtensionFiltersAndDetailExposeGovernanceContext() throws Exception {
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        Department ownerDepartment = departmentRepository.save(new Department("治理部" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        User maintainer = createUser("137" + uniqueDigits(), ownerDepartment.getId(), Role.NORMAL_USER);
        String extensionId = "admin-context-" + uniqueDigits();
        createPublished(extensionId, ExtensionType.PLUGIN, "治理上下文插件",
                VisibilityMode.AUTHORIZED_ONLY, ownerDepartment.getId(), maintainer.getId(), ScopeType.DEPARTMENT);
        UUID extensionPk = extensionPk(extensionId);
        UUID submissionId = UUID.randomUUID();
        UUID revisionId = UUID.randomUUID();
        jdbc.update("""
                insert into activity_events (id, event_type, user_id, extension_pk, idempotency_key, payload)
                values (?, 'DOWNLOAD_STARTED', ?, ?, ?, '{}'::jsonb)
                """, UUID.randomUUID(), maintainer.getId(), extensionPk, "download-" + uniqueDigits());
        jdbc.update("""
                insert into local_events (id, user_id, device_id, extension_pk, extension_business_id, version,
                  event_type, idempotency_key, result, error_code, payload_summary, occurred_at)
                values (?, ?, 'dev-admin-context', ?, ?, '1.0.0', 'PLUGIN_INSTALL', ?, 'SUCCESS', null,
                  '{"target":"codex"}'::jsonb, now())
                """, UUID.randomUUID(), maintainer.getId(), extensionPk, extensionId, "plugin-install-" + uniqueDigits());
        jdbc.update("""
                insert into local_events (id, user_id, device_id, extension_pk, extension_business_id, version,
                  event_type, idempotency_key, result, error_code, payload_summary, occurred_at)
                values (?, ?, 'dev-admin-context', ?, ?, '1.0.0', 'MCP_CONNECTION_TEST', ?, 'FAILURE', 'timeout',
                  '{"nextStep":"检查内网端点"}'::jsonb, now())
                """, UUID.randomUUID(), maintainer.getId(), extensionPk, extensionId, "mcp-failure-" + uniqueDigits());
        jdbc.update("""
                insert into submissions (id, type, extension_type, target_extension_id, submitter_id,
                  submitter_department_id, status, review_owner_type, current_revision_id, effective_revision_id, decided_at)
                values (?, 'VERSION_UPDATE', 'PLUGIN', ?, ?, ?, 'APPROVED', 'SYSTEM_ADMIN', ?, ?, now())
                """, submissionId, extensionId, maintainer.getId(), ownerDepartment.getId(), revisionId, revisionId);
        jdbc.update("""
                insert into submission_revisions (id, submission_id, revision_no, payload_snapshot, package_snapshot, submitted_by)
                values (?, ?, 1, '{"schemaVersion":1,"data":{"extensionId":"%s","extensionType":"PLUGIN"}}'::jsonb,
                  '{"schemaVersion":1,"data":{"precheck":{"definition":{"installMode":"CONFIG_PLUGIN"}}}}'::jsonb, ?)
                """.formatted(extensionId), revisionId, submissionId, maintainer.getId());
        jdbc.update("""
                insert into system_prechecks (id, submission_id, revision_id, rule_status, rule_result,
                  ai_status, ai_result_summary, ai_model, ai_prompt_version)
                values (?, ?, ?, 'PASSED', '{"status":"PASSED"}'::jsonb, 'PASSED',
                  '{"summary":"低风险"}'::jsonb, 'local-ai', 'v1')
                """, UUID.randomUUID(), submissionId, revisionId);
        jdbc.update("""
                insert into reviews (id, submission_id, revision_id, reviewer_id, reviewer_snapshot,
                  decision, comment, reason_codes)
                values (?, ?, ?, ?, '{"name":"Admin"}'::jsonb, 'APPROVE', '通过', '["MANUAL_REVIEW"]'::jsonb)
                """, UUID.randomUUID(), submissionId, revisionId, adminId());
        jdbc.update("""
                insert into audit_logs (id, request_id, actor_id, object_type, object_id, object_name_snapshot,
                  action, result, reason, before_summary, after_summary)
                values (?, 'req-admin-context', ?, 'extension', ?, ?, 'extension.ownership.transfer',
                  'SUCCESS', '职责移交', '{"maintainer":"old"}'::jsonb, '{"maintainer":"new"}'::jsonb)
                """, UUID.randomUUID(), adminId(), extensionPk.toString(), extensionId);

        mockMvc.perform(get("/api/admin/extensions")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("keyword", "治理上下文")
                        .param("type", "PLUGIN")
                        .param("status", "PUBLISHED")
                        .param("visibilityMode", "AUTHORIZED_ONLY")
                        .param("ownerDepartmentId", ownerDepartment.getId().toString())
                        .param("maintainerId", maintainer.getId().toString())
                        .param("riskLevel", "LOW"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].extensionId").value(extensionId))
                .andExpect(jsonPath("$.data.items[0].maintainer.name").value(maintainer.getName()))
                .andExpect(jsonPath("$.data.items[0].ownerDepartment.name").value(ownerDepartment.getName()))
                .andExpect(jsonPath("$.data.items[0].metrics.downloads").value(1));

        mockMvc.perform(get("/api/admin/extensions/" + extensionId)
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.scope.scopeType").value("DEPARTMENT"))
                .andExpect(jsonPath("$.data.metrics.downloads").value(1))
                .andExpect(jsonPath("$.data.metrics.pluginInstallUsers").value(1))
                .andExpect(jsonPath("$.data.metrics.mcpConnectionFailures").value(1))
                .andExpect(jsonPath("$.data.reviewHistory[0].decision").value("APPROVE"))
                .andExpect(jsonPath("$.data.aiPrecheckHistory[0].aiStatus").value("PASSED"))
                .andExpect(jsonPath("$.data.recentAudits[0].requestId").value("req-admin-context"))
                .andExpect(jsonPath("$.data.localEvents[0].eventType").exists())
                .andExpect(jsonPath("$.data.audit.objectType").value("extension"));
    }

    @Test
    void departmentScopeStaysExactAndSelectedDepartmentsMayIncludeChildren() throws Exception {
        Department parent = departmentRepository.save(new Department("parent" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        Department child = departmentRepository.save(new Department("child" + uniqueDigits(), parent.getId()));
        User childUser = createUser("137" + uniqueDigits(), child.getId(), Role.NORMAL_USER);
        String token = login(childUser.getPhone(), "Temp#123456", "DESKTOP");
        String exactDepartmentId = "exact-department-" + uniqueDigits();
        String selectedDepartmentId = "selected-department-" + uniqueDigits();

        createPublished(exactDepartmentId, ExtensionType.SKILL, "Exact Department",
                VisibilityMode.AUTHORIZED_ONLY, parent.getId(), adminId(), ScopeType.DEPARTMENT, true);
        createPublished(selectedDepartmentId, ExtensionType.SKILL, "Selected Department",
                VisibilityMode.AUTHORIZED_ONLY, parent.getId(), adminId(), ScopeType.SELECTED_DEPARTMENTS, true);

        mockMvc.perform(get("/api/extensions/" + exactDepartmentId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/extensions/" + selectedDepartmentId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.extensionId").value(selectedDepartmentId));
    }


    @Test
    void compatibilityAliasesAndGovernanceActionsUseSharedExtensionLogic() throws Exception {
        User author = createUser("137" + uniqueDigits(), ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        Department restrictedDepartment = departmentRepository.save(new Department("restricted" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        Department transferDepartment = departmentRepository.save(new Department("transfer" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        String authorToken = login(author.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String extensionId = "govern-skill-" + uniqueDigits();
        String restrictedId = "alias-restricted-" + uniqueDigits();
        createPublished(extensionId, ExtensionType.SKILL, "Govern Skill",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, ROOT_DEPARTMENT_ID, author.getId(), ScopeType.ALL_EMPLOYEES);
        createPublished(restrictedId, ExtensionType.PLUGIN, "Restricted Plugin",
                VisibilityMode.AUTHORIZED_ONLY, restrictedDepartment.getId(), adminId(), ScopeType.SELECTED_DEPARTMENTS);

        mockMvc.perform(post("/api/extensions/" + extensionId + "/star")
                        .header("Authorization", "Bearer " + authorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"starred\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.starCount").value(1));
        mockMvc.perform(delete("/api/extensions/" + extensionId + "/star")
                        .header("Authorization", "Bearer " + authorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.starred").value(false))
                .andExpect(jsonPath("$.data.starCount").value(0));

        String aliasSearch = mockMvc.perform(get("/api/community/extensions/search")
                        .header("Authorization", "Bearer " + authorToken)
                        .param("q", "Skill"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(aliasSearch).contains(extensionId).doesNotContain(restrictedId);
        String rankings = mockMvc.perform(get("/api/community/rankings")
                        .header("Authorization", "Bearer " + authorToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(rankings).contains(extensionId).doesNotContain(restrictedId);

        mockMvc.perform(post("/api/me/extensions/" + extensionId + "/visibility/reduce")
                        .header("Authorization", "Bearer " + authorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"scope down\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("VISIBILITY_REDUCED"));
        assertThat(jdbc.queryForObject("select visibility_mode from extensions where extension_id = ?", String.class, extensionId))
                .isEqualTo("AUTHORIZED_ONLY");

        mockMvc.perform(post("/api/me/extensions/" + extensionId + "/scope/reduce")
                        .header("Authorization", "Bearer " + authorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"targetScope":{"scopeType":"DEPARTMENT","departments":[{"departmentId":"%s","includeChildren":false}]},"reason":"department only"}
                                """.formatted(ROOT_DEPARTMENT_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SCOPE_REDUCED"));
        assertThat(jdbc.queryForObject("""
                select scope_type from extension_authorization_scopes s
                join extensions e on e.id = s.extension_pk where e.extension_id = ?
                """, String.class, extensionId)).isEqualTo("DEPARTMENT");

        mockMvc.perform(post("/api/me/extensions/" + extensionId + "/delist")
                        .header("Authorization", "Bearer " + authorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"maintenance\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DELISTED"));
        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/relist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"ready\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PUBLISHED"));
        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/ownership-transfer")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetOwnerDepartmentId\":\"" + transferDepartment.getId() + "\",\"reason\":\"handoff\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("OWNERSHIP_TRANSFERRED"));
        assertThat(jdbc.queryForObject("select count(*) from extension_ownership_history", Long.class)).isGreaterThan(0L);
        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/security-delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"securityReason\":\"risk\",\"impactSummary\":\"one extension\",\"handlingAdvice\":\"remove until fixed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SECURITY_DELISTED"));
        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/archive")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"end\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("ARCHIVED"));
        Department managedDepartment = departmentRepository.save(new Department("managed" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        Department outsideDepartment = departmentRepository.save(new Department("outside" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        User managedAdmin = createUser("137" + uniqueDigits(), managedDepartment.getId(), Role.DEPARTMENT_ADMIN);
        User outsideAdmin = createUser("137" + uniqueDigits(), outsideDepartment.getId(), Role.DEPARTMENT_ADMIN);
        String managedAdminToken = login(managedAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String outsideAdminToken = login(outsideAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String managedExtensionId = "managed-skill-" + uniqueDigits();
        createPublished(managedExtensionId, ExtensionType.SKILL, "Managed Skill",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, managedDepartment.getId(), author.getId(), ScopeType.ALL_EMPLOYEES);

        mockMvc.perform(get("/api/admin/extensions")
                        .header("Authorization", "Bearer " + managedAdminToken)
                        .param("keyword", managedExtensionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].extensionId").value(managedExtensionId));
        mockMvc.perform(get("/api/admin/extensions")
                        .header("Authorization", "Bearer " + outsideAdminToken)
                        .param("keyword", managedExtensionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty());
        mockMvc.perform(get("/api/admin/extensions/" + managedExtensionId)
                        .header("Authorization", "Bearer " + outsideAdminToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
        mockMvc.perform(post("/api/admin/extensions/" + managedExtensionId + "/delist")
                        .header("Authorization", "Bearer " + outsideAdminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"outside denied\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
    }

    @Test
    void adminExtensionGovernanceRequiresIdempotencyAndAuditsSecurityReason() throws Exception {
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        User author = createUser("137" + uniqueDigits(), ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        String extensionId = "idem-govern-" + uniqueDigits();
        createPublished(extensionId, ExtensionType.SKILL, "Idempotent Govern Skill",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, ROOT_DEPARTMENT_ID, author.getId(), ScopeType.ALL_EMPLOYEES);

        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"maintenance\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        String key = newIdempotencyKey();
        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"maintenance\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DELISTED"));
        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"maintenance\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DELISTED"));
        assertThat(jdbc.queryForObject("""
                select count(*) from audit_logs
                 where action = 'extension.delist' and object_name_snapshot = ?
                """, Long.class, extensionId)).isEqualTo(1L);
        assertThat(jdbc.queryForObject("""
                select count(*) from idempotency_records
                 where operation = ? and idempotency_key = ?
                """, Long.class, "admin.extension.delist", key)).isEqualTo(1L);

        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"different\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("idempotency_conflict"));

        String securityExtensionId = "security-govern-" + uniqueDigits();
        createPublished(securityExtensionId, ExtensionType.MCP_SERVER, "Security Govern Server",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, ROOT_DEPARTMENT_ID, author.getId(), ScopeType.ALL_EMPLOYEES);
        mockMvc.perform(post("/api/admin/extensions/" + securityExtensionId + "/security-delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"reason":"generic note","reasonType":"vulnerability","securityReason":"credential leak",
                                 "impactSummary":"12 users connected","handlingAdvice":"uninstall until fixed"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SECURITY_DELISTED"));
        assertThat(jdbc.queryForObject("""
                select reason from audit_logs
                 where action = 'extension.security_delist' and object_name_snapshot = ?
                 order by created_at desc limit 1
                """, String.class, securityExtensionId)).isEqualTo("credential leak");
        assertThat(jdbc.queryForObject("""
                select after_summary::text from audit_logs
                 where action = 'extension.security_delist' and object_name_snapshot = ?
                 order by created_at desc limit 1
                """, String.class, securityExtensionId))
                .contains("vulnerability", "12 users connected", "uninstall until fixed");

        String maxLengthExtensionId = "long-" + UUID.randomUUID().toString().replace("-", "") + "x".repeat(91);
        String longKey = newIdempotencyKey();
        createPublished(maxLengthExtensionId, ExtensionType.SKILL, "Long Id Governance Skill",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, ROOT_DEPARTMENT_ID, author.getId(), ScopeType.ALL_EMPLOYEES);
        mockMvc.perform(post("/api/admin/extensions/" + maxLengthExtensionId + "/delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", longKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"long id\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DELISTED"));
        assertThat(jdbc.queryForObject("""
                select operation from idempotency_records where idempotency_key = ?
                """, String.class, longKey)).isEqualTo("admin.extension.delist");
    }

    @Test
    void securityDelistedExtensionsCanOnlyBeRelistedBySystemAdmins() throws Exception {
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        User author = createUser("137" + uniqueDigits(), ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        Department managedDepartment = departmentRepository.save(new Department("managed" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        User managedAdmin = createUser("137" + uniqueDigits(), managedDepartment.getId(), Role.DEPARTMENT_ADMIN);
        String managedAdminToken = login(managedAdmin.getPhone(), "Temp#123456", "ADMIN_WEB");
        String extensionId = "security-managed-" + uniqueDigits();
        createPublished(extensionId, ExtensionType.MCP_SERVER, "Security Managed Server",
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, managedDepartment.getId(), author.getId(), ScopeType.ALL_EMPLOYEES);

        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/security-delist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"securityReason":"credential leak",
                                 "impactSummary":"managed department affected",
                                 "handlingAdvice":"system admin review required"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SECURITY_DELISTED"));

        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/relist")
                        .header("Authorization", "Bearer " + managedAdminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"department says ready\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
        assertThat(jdbc.queryForObject("select status from extensions where extension_id = ?", String.class, extensionId))
                .isEqualTo("SECURITY_DELISTED");

        mockMvc.perform(post("/api/admin/extensions/" + extensionId + "/relist")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"system risk cleared\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PUBLISHED"));
    }

    private void createPublished(String extensionId, ExtensionType type, String name, VisibilityMode visibilityMode,
            UUID ownerDepartmentId, UUID authorId, ScopeType scopeType) {
        createPublished(extensionId, type, name, visibilityMode, ownerDepartmentId, authorId, scopeType,
                scopeType == ScopeType.DEPARTMENT_TREE);
    }


    private void createPublished(String extensionId, ExtensionType type, String name, VisibilityMode visibilityMode,
            UUID ownerDepartmentId, UUID authorId, ScopeType scopeType, boolean includeChildren) {
        UUID id = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        jdbc.update("""
                insert into extensions (id, extension_id, type, name, description, category, tags, status,
                  visibility_mode, owner_department_id, maintainer_id, author_id, current_version_id,
                  current_version, risk_level, risk_summary)
                values (?, ?, ?, ?, ?, 'test', '[\"test\"]'::jsonb, 'PUBLISHED', ?, ?, ?, ?, ?, '1.0.0', 'LOW', 'seed')
                """, id, extensionId, type.name(), name, name + " description", visibilityMode.name(),
                ownerDepartmentId, authorId, authorId, versionId);
        jdbc.update("""
                insert into extension_versions (id, extension_pk, version, status, payload_snapshot, package_snapshot, changelog, published_at)
                values (?, ?, '1.0.0', 'PUBLISHED', '{"schemaVersion":1,"source":"seed","data":{}}'::jsonb,
                  '{"schemaVersion":1,"source":"seed","data":{"mode":"PLACEHOLDER"}}'::jsonb, 'seed', now())
                """, versionId, id);
        UUID scopeId = UUID.randomUUID();
        jdbc.update("insert into extension_authorization_scopes (id, extension_pk, scope_type) values (?, ?, ?)",
                scopeId, id, scopeType.name());
        if (scopeType != ScopeType.ALL_EMPLOYEES) {
            jdbc.update("""
                    insert into extension_authorized_departments (id, scope_id, department_id, include_children)
                    values (?, ?, ?, ?)
                    """, UUID.randomUUID(), scopeId, ownerDepartmentId, includeChildren);
        }
    }

    private User createUser(String phone, UUID departmentId, Role role) {
        User user = new User("测试用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode("Temp#123456"), PasswordService.ALGORITHM, departmentId, role);
        user.setMustChangePassword(false);
        return userRepository.save(user);
    }

    private UUID adminId() {
        return userRepository.findByPhoneAndStatusNot("13800000000", UserStatus.DELETED).orElseThrow().getId();
    }

    private String login(String phone, String password, String clientType) throws Exception {
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"" + password + "\",\"clientType\":\"" + clientType + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return response.replaceAll(".*\"token\":\"([^\"]+)\".*", "$1");
    }

    private String uniqueDigits() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    private UUID extensionPk(String extensionId) {
        return jdbc.queryForObject("select id from extensions where extension_id = ?", UUID.class, extensionId);
    }

    private String newIdempotencyKey() {
        return "idem-" + UUID.randomUUID();
    }
}
