package com.enterpriseagent.hub;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;

@AutoConfigureMockMvc
class AuditAdminApiTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void adminCanQueryAndExportAuditLogsByRequestIdAndObject() throws Exception {
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-audit");
        String requestId = "req-audit-m8-" + System.nanoTime();
        String key = "audit.retention";
        jdbc.update("delete from settings_history where key = ?", key);
        jdbc.update("delete from settings where key = ?", key);

        mockMvc.perform(patch("/api/admin/settings/" + key)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("X-Request-ID", requestId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":0,\"reason\":\"audit query seed\",\"value\":{\"enabled\":true}}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/admin/audit-logs")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("requestId", requestId)
                        .param("objectType", "settings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].requestId").value(requestId))
                .andExpect(jsonPath("$.data.items[0].action").value("settings.update"))
                .andExpect(jsonPath("$.data.items[0].objectId").value(key));

        String csv = mockMvc.perform(get("/api/admin/audit-logs/export")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("X-Request-ID", requestId + "-export")
                        .param("requestId", requestId)
                        .param("objectType", "settings"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/csv"))
                .andReturn().getResponse().getContentAsString();
        assertThat(csv).contains("requestId", requestId, "settings.update", key);
        assertThat(jdbc.queryForObject("""
                select count(*) from audit_logs
                 where request_id = ? and action = 'audit.export' and object_type = 'audit_log'
                """, Long.class, requestId + "-export")).isEqualTo(1L);
    }

    @Test
    void nonAdminCannotQueryAuditLogs() throws Exception {
        User user = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("134"), Role.NORMAL_USER);
        String token = M8TestSupport.login(mockMvc, user.getPhone(), "Temp#123456", "DESKTOP", "audit-user-device");

        mockMvc.perform(get("/api/admin/audit-logs")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }
}
