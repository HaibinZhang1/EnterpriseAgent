package com.enterpriseagent.hub;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
class SettingsAdminApiTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void systemAdminUpdatesSettingsWithExpectedVersionHistoryAuditAndRedaction() throws Exception {
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-settings");
        String key = "client.update.policy";
        jdbc.update("delete from settings_history where key = ?", key);
        jdbc.update("delete from settings where key = ?", key);

        mockMvc.perform(patch("/api/admin/settings/" + key)
                        .header("Authorization", "Bearer " + adminToken)
                        .header("X-Request-ID", "req-settings-m8")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"expectedVersion":0,"reason":"m8 setting create","value":{"enabled":true,"token":"super-secret-token","nested":{"password":"plain-password"}}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.key").value(key))
                .andExpect(jsonPath("$.data.version").value(1))
                .andExpect(jsonPath("$.data.value.enabled").value(true))
                .andExpect(jsonPath("$.data.value.token").value("***MASKED***"))
                .andExpect(jsonPath("$.data.value.nested.password").value("***MASKED***"));

        mockMvc.perform(patch("/api/admin/settings/" + key)
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{" + "\"expectedVersion\":0,\"reason\":\"stale\",\"value\":{\"enabled\":false}}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("setting_version_conflict"));

        mockMvc.perform(get("/api/admin/settings")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("keyword", key))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].key").value(key));

        assertThat(jdbc.queryForObject("select count(*) from settings_history where key = ?", Long.class, key))
                .isEqualTo(1L);
        String auditSummary = jdbc.queryForObject("""
                select after_summary::text from audit_logs
                 where request_id = 'req-settings-m8' and action = 'settings.update'
                 order by created_at desc limit 1
                """, String.class);
        assertThat(auditSummary).contains("***MASKED***")
                .doesNotContain("super-secret-token", "plain-password");
    }

    @Test
    void unknownSettingKeyIsRejected() throws Exception {
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-settings-unknown");

        mockMvc.perform(patch("/api/admin/settings/m8.public." + System.nanoTime())
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"expectedVersion":0,"reason":"unknown key","value":{"enabled":true}}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void nonAdminCannotAccessSettingsAdministration() throws Exception {
        User user = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("135"), Role.NORMAL_USER);
        String token = M8TestSupport.login(mockMvc, user.getPhone(), "Temp#123456", "DESKTOP", "settings-user-device");

        mockMvc.perform(get("/api/admin/settings")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }
}
