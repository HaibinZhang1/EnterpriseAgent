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
                """, Long.class, "admin.extension.delist:" + extensionId, key)).isEqualTo(1L);

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
                                {"reason":"generic note","securityReason":"credential leak",
                                 "impactSummary":"12 users connected","handlingAdvice":"uninstall until fixed"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SECURITY_DELISTED"));
        assertThat(jdbc.queryForObject("""
                select reason from audit_logs
                 where action = 'extension.security_delist' and object_name_snapshot = ?
                 order by created_at desc limit 1
                """, String.class, securityExtensionId)).isEqualTo("credential leak");
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

    private String newIdempotencyKey() {
        return "idem-" + UUID.randomUUID();
    }
}
