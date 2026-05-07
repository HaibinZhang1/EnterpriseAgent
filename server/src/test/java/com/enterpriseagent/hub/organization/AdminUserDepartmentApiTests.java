package com.enterpriseagent.hub.organization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.common.audit.AuditLogRepository;
import com.enterpriseagent.hub.common.audit.AuditResult;

@AutoConfigureMockMvc
class AdminUserDepartmentApiTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private DepartmentRepository departmentRepository;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private AuditLogRepository auditLogRepository;

    @Test
    void systemAdminCanCreateDepartmentAndUserUnderAdminPaths() throws Exception {
        String adminToken = loginAdmin();
        String departmentName = "研发" + UUID.randomUUID().toString().substring(0, 8);

        String departmentResponse = mockMvc.perform(post("/api/admin/departments")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"parentId\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"" + departmentName + "\",\"reason\":\"test\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value(departmentName))
                .andReturn().getResponse().getContentAsString();
        String departmentId = departmentResponse.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        String phone = "137" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);

        mockMvc.perform(post("/api/admin/users")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"王五\",\"phone\":\"" + phone + "\",\"departmentId\":\"" + departmentId + "\",\"role\":\"NORMAL_USER\",\"initialPassword\":\"Temp#123456\",\"mustChangePassword\":true,\"reason\":\"test\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.phoneMasked").value(phone.substring(0, 3) + "****" + phone.substring(7)))
                .andExpect(jsonPath("$.data.mustChangePassword").value(true));

        assertThat(auditLogRepository.findAll()).anySatisfy(log -> assertThat(log.getAction()).isEqualTo("user.create"));
    }

    @Test
    void systemAdminUserLifecycleCoversListUpdateResetFreezeUnfreezeAndDelete() throws Exception {
        String adminToken = loginAdmin();
        UUID sourceDept = createDepartment(adminToken, UUID.fromString("00000000-0000-0000-0000-000000000001"), "用户源部门");
        UUID targetDept = createDepartment(adminToken, UUID.fromString("00000000-0000-0000-0000-000000000001"), "用户目标部门");
        String phone = createUser(adminToken, sourceDept, "NORMAL_USER");
        UUID userId = userRepository.findByPhoneAndStatusNot(phone, UserStatus.DELETED).orElseThrow().getId();
        String oldSessionToken = login(phone, "Temp#123456", "DESKTOP");

        mockMvc.perform(get("/api/admin/users")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("keyword", phone))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].id").value(userId.toString()));

        mockMvc.perform(get("/api/admin/users/" + userId)
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.phoneMasked").value(phone.substring(0, 3) + "****" + phone.substring(7)));

        mockMvc.perform(patch("/api/admin/users/" + userId)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"生命周期用户\",\"departmentId\":\"" + targetDept
                                + "\",\"role\":\"DEPARTMENT_ADMIN\",\"reason\":\"role and department change\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("生命周期用户"))
                .andExpect(jsonPath("$.data.departmentId").value(targetDept.toString()))
                .andExpect(jsonPath("$.data.role").value("DEPARTMENT_ADMIN"));

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + oldSessionToken))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("unauthenticated"));

        String resetResponse = mockMvc.perform(post("/api/admin/users/" + userId + "/reset-password")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mustChangePassword\":true,\"reason\":\"reset lifecycle\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.resetToken").isString())
                .andExpect(jsonPath("$.data.mustChangePassword").value(true))
                .andReturn().getResponse().getContentAsString();
        String resetToken = extractJsonString(resetResponse, "resetToken");

        assertThat(auditLogRepository.findAll().toString()).doesNotContain(resetToken);

        mockMvc.perform(post("/api/auth/reset-password/complete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"resetToken\":\"" + resetToken + "\",\"newPassword\":\"Reset#123456\"}"))
                .andExpect(status().isOk());
        String newSessionToken = login(phone, "Reset#123456", "ADMIN_WEB");

        mockMvc.perform(post("/api/admin/users/" + userId + "/freeze")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"freeze lifecycle\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("FROZEN"));

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + newSessionToken))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"Reset#123456\",\"clientType\":\"ADMIN_WEB\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("unauthenticated"));

        mockMvc.perform(post("/api/admin/users/" + userId + "/unfreeze")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"unfreeze lifecycle\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("ACTIVE"));
        login(phone, "Reset#123456", "ADMIN_WEB");

        mockMvc.perform(delete("/api/admin/users/" + userId)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"delete lifecycle\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/admin/users/" + userId)
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("resource_not_found"));

        assertThat(auditLogRepository.findAll()).anySatisfy(log -> assertThat(log.getAction()).isEqualTo("user.delete"));
    }

    @Test
    void departmentLifecycleCoversTreeGetUpdateEnableDisableAndDeleteGuards() throws Exception {
        String adminToken = loginAdmin();
        UUID parent = createDepartment(adminToken, UUID.fromString("00000000-0000-0000-0000-000000000001"), "生命周期父部门");
        UUID child = createDepartment(adminToken, parent, "生命周期子部门");

        mockMvc.perform(get("/api/admin/departments/tree")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("rootDepartmentId", parent.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(parent.toString()))
                .andExpect(jsonPath("$.data[0].children[0].id").value(child.toString()));

        mockMvc.perform(get("/api/admin/departments/" + child)
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.parentId").value(parent.toString()));

        mockMvc.perform(patch("/api/admin/departments/" + child)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"生命周期子部门改名\",\"reason\":\"rename\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("生命周期子部门改名"));

        mockMvc.perform(delete("/api/admin/departments/" + child)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"active delete blocked\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("state_conflict"));

        mockMvc.perform(post("/api/admin/departments/" + child + "/disable")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"disable empty child\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DISABLED"));

        mockMvc.perform(post("/api/admin/departments/" + child + "/enable")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"enable empty child\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("ACTIVE"));

        mockMvc.perform(post("/api/admin/departments/" + child + "/disable")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"disable before delete\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/admin/departments/" + child)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"delete disabled empty child\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/admin/departments/" + child)
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("resource_not_found"));

        assertThat(auditLogRepository.findAll()).anySatisfy(log -> assertThat(log.getAction()).isEqualTo("department.delete"));
    }

    @Test
    void departmentAdminCanManageStrictDescendantAdminButNotSameDepartmentAdmin() throws Exception {
        String adminToken = loginAdmin();
        UUID parent = createDepartment(adminToken, UUID.fromString("00000000-0000-0000-0000-000000000001"), "父部门");
        UUID child = createDepartment(adminToken, parent, "子部门");
        String parentAdminPhone = createUser(adminToken, parent, "DEPARTMENT_ADMIN");
        String sameAdminPhone = createUser(adminToken, parent, "DEPARTMENT_ADMIN");
        String childAdminPhone = createUser(adminToken, child, "DEPARTMENT_ADMIN");
        String parentAdminToken = login(parentAdminPhone, "Temp#123456", "ADMIN_WEB");
        UUID sameAdminId = userRepository.findByPhoneAndStatusNot(sameAdminPhone, com.enterpriseagent.hub.auth.UserStatus.DELETED).orElseThrow().getId();
        UUID childAdminId = userRepository.findByPhoneAndStatusNot(childAdminPhone, com.enterpriseagent.hub.auth.UserStatus.DELETED).orElseThrow().getId();

        mockMvc.perform(post("/api/admin/users/" + sameAdminId + "/freeze")
                        .header("Authorization", "Bearer " + parentAdminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"same department denied\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));

        assertThat(auditLogRepository.findAll()).anySatisfy(log -> {
            assertThat(log.getAction()).isEqualTo("user.freeze");
            assertThat(log.getResult()).isEqualTo(AuditResult.FAILURE);
        });

        mockMvc.perform(post("/api/admin/users/" + childAdminId + "/freeze")
                        .header("Authorization", "Bearer " + parentAdminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"strict descendant allowed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("FROZEN"));
    }

    @Test
    void cannotDeleteLastAvailableSystemAdmin() throws Exception {
        String adminToken = loginAdmin();
        UUID adminId = userRepository.findByPhoneAndStatusNot("13800000000", com.enterpriseagent.hub.auth.UserStatus.DELETED).orElseThrow().getId();

        mockMvc.perform(delete("/api/admin/users/" + adminId)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"must be blocked\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("last_system_admin_required"));
    }

    @Test
    void disablingDepartmentRevokesSessionsAndBlocksLoginForItsUsers() throws Exception {
        String adminToken = loginAdmin();
        UUID dept = createDepartment(adminToken, UUID.fromString("00000000-0000-0000-0000-000000000001"), "停用部门");
        String phone = createUser(adminToken, dept, "NORMAL_USER");
        String token = login(phone, "Temp#123456", "DESKTOP");

        mockMvc.perform(post("/api/admin/departments/" + dept + "/disable")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"disable test\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DISABLED"));

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"Temp#123456\",\"clientType\":\"DESKTOP\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("department_disabled"));
    }

    @Test
    void normalUserCannotReadAdminUserListOrDepartmentTree() throws Exception {
        String adminToken = loginAdmin();
        UUID dept = createDepartment(adminToken, UUID.fromString("00000000-0000-0000-0000-000000000001"), "普通用户读管理端");
        String phone = createUser(adminToken, dept, "NORMAL_USER");
        String normalToken = login(phone, "Temp#123456", "DESKTOP");

        mockMvc.perform(get("/api/admin/users")
                        .header("Authorization", "Bearer " + normalToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));

        mockMvc.perform(get("/api/admin/departments/tree")
                        .header("Authorization", "Bearer " + normalToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
    }

    @Test
    void adminWritesRequireAndReplayIdempotencyKey() throws Exception {
        String adminToken = loginAdmin();
        String key = newIdempotencyKey();
        String name = "幂等部门" + UUID.randomUUID().toString().substring(0, 8);
        String body = "{\"parentId\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"" + name
                + "\",\"reason\":\"idempotency\"}";

        mockMvc.perform(post("/api/admin/departments")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        String first = mockMvc.perform(post("/api/admin/departments")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String firstId = extractJsonString(first, "id");

        String replay = mockMvc.perform(post("/api/admin/departments")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(extractJsonString(replay, "id")).isEqualTo(firstId);
        assertThat(departmentRepository.findByStatusNot(DepartmentStatus.DELETED))
                .filteredOn(department -> department.getName().equals(name))
                .hasSize(1);

        mockMvc.perform(post("/api/admin/departments")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.replace(name, name + "x")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("idempotency_conflict"));
    }

    @Test
    void departmentAdminCannotDisableOwnDepartment() throws Exception {
        String adminToken = loginAdmin();
        UUID departmentId = createDepartment(adminToken, UUID.fromString("00000000-0000-0000-0000-000000000001"), "自部门边界");
        String adminPhone = createUser(adminToken, departmentId, "DEPARTMENT_ADMIN");
        String departmentAdminToken = login(adminPhone, "Temp#123456", "ADMIN_WEB");

        mockMvc.perform(post("/api/admin/departments/" + departmentId + "/disable")
                        .header("Authorization", "Bearer " + departmentAdminToken)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"own department denied\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("permission_denied"));
    }

    private String loginAdmin() throws Exception {
        return login("13800000000", "Admin#123456", "ADMIN_WEB");
    }

    private String login(String phone, String password, String clientType) throws Exception {
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"" + password + "\",\"clientType\":\"" + clientType + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return response.replaceAll(".*\\\"token\\\":\\\"([^\\\"]+)\\\".*", "$1");
    }

    private UUID createDepartment(String token, UUID parentId, String prefix) throws Exception {
        String name = prefix + UUID.randomUUID().toString().substring(0, 8);
        String response = mockMvc.perform(post("/api/admin/departments")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"parentId\":\"" + parentId + "\",\"name\":\"" + name + "\",\"reason\":\"test\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(response.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1"));
    }

    private String createUser(String token, UUID departmentId, String role) throws Exception {
        String phone = "136" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        mockMvc.perform(post("/api/admin/users")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", newIdempotencyKey())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"用户\",\"phone\":\"" + phone + "\",\"departmentId\":\"" + departmentId + "\",\"role\":\"" + role + "\",\"initialPassword\":\"Temp#123456\",\"mustChangePassword\":false,\"reason\":\"test\"}"))
                .andExpect(status().isOk());
        return phone;
    }

    private String newIdempotencyKey() {
        return UUID.randomUUID().toString();
    }

    private String extractJsonString(String response, String field) {
        return response.replaceAll(".*\\\"" + field + "\\\":\\\"([^\\\"]+)\\\".*", "$1");
    }
}
