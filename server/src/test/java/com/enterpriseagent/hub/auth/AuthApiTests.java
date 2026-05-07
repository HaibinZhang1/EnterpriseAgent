package com.enterpriseagent.hub.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import com.enterpriseagent.hub.common.audit.AuditLogRepository;

@AutoConfigureMockMvc
class AuthApiTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private SessionRepository sessionRepository;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private TokenService tokenService;
    @Autowired
    private AuditLogRepository auditLogRepository;

    @Test
    void loginReturnsTokenOnceAndStoresOnlyTokenHash() throws Exception {
        String response = mockMvc.perform(post("/api/auth/login")
                        .header("X-Request-ID", "req_login_success")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"phone":"13800000000","password":"Admin#123456","clientType":"ADMIN_WEB"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value("req_login_success"))
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.token").isString())
                .andExpect(jsonPath("$.data.user.role").value("SYSTEM_ADMIN"))
                .andReturn().getResponse().getContentAsString();

        String token = response.replaceAll(".*\\\"token\\\":\\\"([^\\\"]+)\\\".*", "$1");
        assertThat(sessionRepository.findAll())
                .anySatisfy(session -> {
                    assertThat(session.getTokenHash()).isNotBlank();
                    assertThat(session.getTokenHash()).isNotEqualTo(token);
                });
        assertThat(auditLogRepository.findAll()).anySatisfy(log -> assertThat(log.getAction()).isEqualTo("auth.login.success"));
    }

    @Test
    void bearerTokenAuthenticatesMeAndInvalidTokenUsesUnauthenticatedEnvelope() throws Exception {
        String token = loginAsTestAdmin();

        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + token)
                        .header("X-Request-ID", "req_me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value("req_me"))
                .andExpect(jsonPath("$.data.role").value("SYSTEM_ADMIN"));

        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer invalid-token")
                        .header("X-Request-ID", "req_bad_token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.requestId").value("req_bad_token"))
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("unauthenticated"));
    }

    @Test
    void repeatedLoginFailuresLockAccountWithoutRevealingExistence() throws Exception {
        String phone = "139" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        TestUsers.createNormalUser(userRepository, phone, "Correct#123456");

        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"phone\":\"" + phone + "\",\"password\":\"Wrong#123\",\"clientType\":\"DESKTOP\"}"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("unauthenticated"));
        }

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"Correct#123456\",\"clientType\":\"DESKTOP\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("account_locked"));
    }

    @Test
    void repeatedFailuresDoNotLockLastAvailableSystemAdmin() throws Exception {
        var admin = userRepository.findByPhoneAndStatusNot("13800000000", UserStatus.DELETED).orElseThrow();
        admin.setLockedUntil(null);
        userRepository.saveAndFlush(admin);

        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"phone":"13800000000","password":"Wrong#123","clientType":"ADMIN_WEB"}
                                    """))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("unauthenticated"));
        }

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"phone":"13800000000","password":"Admin#123456","clientType":"ADMIN_WEB"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.user.role").value("SYSTEM_ADMIN"));

        var reloaded = userRepository.findByPhoneAndStatusNot("13800000000", UserStatus.DELETED).orElseThrow();
        assertThat(reloaded.getLockedUntil()).isNull();
    }

    @Test
    void adminSessionIdleExpirySlidesOnAuthenticatedUse() throws Exception {
        String token = loginAsTestAdmin();
        var session = sessionRepository.findByTokenHash(tokenService.hash(token)).orElseThrow();
        var initialIdleExpiry = session.getIdleExpiresAt();

        Thread.sleep(20);

        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        var reloaded = sessionRepository.findByTokenHash(tokenService.hash(token)).orElseThrow();
        assertThat(reloaded.getIdleExpiresAt()).isAfter(initialIdleExpiry);
        assertThat(reloaded.getIdleExpiresAt()).isBeforeOrEqualTo(reloaded.getExpiresAt());
    }

    @Test
    void changePasswordRevokesPriorSessionAndDoesNotAuditPlaintextPassword() throws Exception {
        String phone = "139" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        TestUsers.createNormalUser(userRepository, phone, "Old#123456");
        String token = login(phone, "Old#123456", "DESKTOP");

        mockMvc.perform(post("/api/auth/change-password")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"oldPassword\":\"Old#123456\",\"newPassword\":\"New#123456\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("unauthenticated"));

        assertThat(auditLogRepository.findAll().toString()).doesNotContain("Old#123456", "New#123456");
    }

    @Test
    void refreshIsExplicitlyUnsupportedInM2() throws Exception {
        mockMvc.perform(post("/api/auth/refresh").header("X-Request-ID", "req_refresh"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.requestId").value("req_refresh"))
                .andExpect(jsonPath("$.error.code").value("refresh_not_supported"));
    }

    private String loginAsTestAdmin() throws Exception {
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
}
