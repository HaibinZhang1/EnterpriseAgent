package com.enterpriseagent.hub;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
class ClientDeviceApiTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void desktopRegistersHeartbeatsSyncsIdempotentEventsAndAdminCanInspectDevice() throws Exception {
        User user = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("136"), Role.NORMAL_USER);
        String deviceId = "m8-device-" + java.util.UUID.randomUUID();
        String heartbeatVersion = "1.0." + Long.toUnsignedString(System.nanoTime());
        String token = M8TestSupport.login(mockMvc, user.getPhone(), "Temp#123456", "DESKTOP", deviceId);
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-m8");

        mockMvc.perform(post("/api/client-devices/register")
                        .header("Authorization", "Bearer " + token)
                        .header("X-Client-Version", "1.0.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"deviceId":"%s","clientVersion":"1.0.0","hostnameHash":"host-hash","osVersion":"Windows 11","arch":"X64","installChannel":"STABLE"}
                                """.formatted(deviceId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.registered").value(true))
                .andExpect(jsonPath("$.data.deviceStatus").value("ACTIVE"));

        User otherUser = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("136"), Role.NORMAL_USER);
        String otherToken = M8TestSupport.login(mockMvc, otherUser.getPhone(), "Temp#123456", "DESKTOP", deviceId);
        mockMvc.perform(post("/api/client-devices/register")
                        .header("Authorization", "Bearer " + otherToken)
                        .header("X-Client-Version", "1.0.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"deviceId":"%s","clientVersion":"1.0.0","hostnameHash":"other-host","osVersion":"Windows 11","arch":"X64","installChannel":"STABLE"}
                                """.formatted(deviceId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("state_conflict"));
        assertThat(jdbc.queryForObject("select user_id from client_devices where device_id = ?", java.util.UUID.class, deviceId))
                .isEqualTo(user.getId());

        mockMvc.perform(post("/api/client-devices/heartbeat")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"clientVersion\":\"" + heartbeatVersion + "\",\"localEventQueueSize\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(true));

        mockMvc.perform(post("/api/client-devices/events")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"deviceId":"%s","events":[
                                  {"idempotencyKey":"event-1","eventType":"UPDATE_HASH_FAILED","result":"FAILURE","errorCode":"hash_mismatch","payloadSummary":{"localEventId":"local-1"}},
                                  {"idempotencyKey":"event-1","eventType":"UPDATE_HASH_FAILED","result":"FAILURE","errorCode":"hash_mismatch","payloadSummary":{"localEventId":"local-1"}}
                                ]}
                                """.formatted(deviceId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].status").value("ACCEPTED"))
                .andExpect(jsonPath("$.data.results[1].status").value("IGNORED"));

        mockMvc.perform(get("/api/admin/client-devices")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("keyword", deviceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].device_id").value(deviceId))
                .andExpect(jsonPath("$.data.items[0].deviceId").value(deviceId))
                .andExpect(jsonPath("$.data.items[0].clientVersion").value(heartbeatVersion));

        String distributionResponse = mockMvc.perform(get("/api/admin/client-devices/version-distribution")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(distributionResponse).contains(heartbeatVersion).contains("deviceCount");

        mockMvc.perform(get("/api/admin/client-devices/" + deviceId)
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.device_id").value(deviceId))
                .andExpect(jsonPath("$.data.deviceId").value(deviceId))
                .andExpect(jsonPath("$.data.clientVersion").value(heartbeatVersion))
                .andExpect(jsonPath("$.data.events[0].event_type").exists());

        mockMvc.perform(get("/api/admin/client-devices")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/client-devices/version-distribution")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());

        assertThat(jdbc.queryForObject("select count(*) from client_device_events where device_id = ?", Long.class, deviceId))
                .isEqualTo(3L);
        assertThat(jdbc.queryForObject("select count(*) from audit_logs where action = 'client_device.register' and device_id = ?",
                Long.class, deviceId)).isEqualTo(1L);
    }
}
