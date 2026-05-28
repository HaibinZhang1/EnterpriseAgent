package com.enterpriseagent.hub.localevents;

import static org.assertj.core.api.Assertions.assertThat;
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

@AutoConfigureMockMvc
class LocalEventsSyncApiTests extends PostgresIntegrationTestBase {
    private static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void syncPersistsEventsDeduplicatesAndRedactsPayloads() throws Exception {
        User user = createUser();
        String token = login(user.getPhone(), "Temp#123456");
        String deviceId = "device_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String key = deviceId + ":skill.install:demo:1";
        String request = """
                {"deviceId":"%s","events":[{"idempotencyKey":"%s","extensionId":null,"version":"1.0.0","type":"SKILL_INSTALL","result":"SUCCESS","occurredAt":"2026-05-06T10:00:00Z","payloadSummary":{"token":"EAH_SENTINEL_SECRET_DO_NOT_PERSIST","targetCount":1}}]}
                """.formatted(deviceId, key);

        mockMvc.perform(post("/api/local-events/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].status").value("ACCEPTED"));
        mockMvc.perform(post("/api/local-events/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].status").value("IGNORED"));

        String payload = jdbc.queryForObject("select payload_summary::text from local_events where idempotency_key = ?",
                String.class, key);
        assertThat(payload).doesNotContain("EAH_SENTINEL_SECRET_DO_NOT_PERSIST");
        assertThat(jdbc.queryForObject("select count(*) from local_events where device_id = ? and idempotency_key = ?",
                Long.class, deviceId, key)).isEqualTo(1L);
    }

    @Test
    void syncRejectsInvalidEventWithoutPersistingIt() throws Exception {
        User user = createUser();
        String token = login(user.getPhone(), "Temp#123456");
        mockMvc.perform(post("/api/local-events/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"device_1\",\"events\":[{\"idempotencyKey\":\"bad-key\"}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].status").value("REJECTED"))
                .andExpect(jsonPath("$.data.results[0].errorCode").value("invalid_event"));
        assertThat(jdbc.queryForObject("select count(*) from local_events where idempotency_key = ?",
                Long.class, "bad-key")).isZero();
    }

    private User createUser() {
        String phone = "137" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        User user = new User("测试用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode("Temp#123456"), PasswordService.ALGORITHM, ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        user.setMustChangePassword(false);
        return userRepository.save(user);
    }

    private String login(String phone, String password) throws Exception {
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"" + password + "\",\"clientType\":\"DESKTOP\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return response.replaceAll(".*\"token\":\"([^\"]+)\".*", "$1");
    }
}
