package com.enterpriseagent.hub;

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
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;

@AutoConfigureMockMvc
class M8BusinessE2eTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void m8DeviceUpdateAuditBusinessFlowWorksEndToEnd() throws Exception {
        UUID adminId = jdbc.queryForObject("select id from users where phone = '13800000000'", UUID.class);
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-m8-e2e");
        User user = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("133"), Role.NORMAL_USER);
        String deviceId = "m8-e2e-device-" + UUID.randomUUID();
        String userToken = M8TestSupport.login(mockMvc, user.getPhone(), "Temp#123456", "DESKTOP", deviceId);
        M8TestSupport.SeededUpdatePackage seed = M8TestSupport.seedClientUpdatePackage(jdbc, adminId,
                "m8 business e2e client update " + UUID.randomUUID());
        String version = "4." + System.nanoTime() + ".0";
        String channel = "E2E" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();

        mockMvc.perform(post("/api/client-devices/register")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Client-Version", "1.0.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"clientVersion\":\"1.0.0\",\"arch\":\"X64\",\"installChannel\":\"" + channel + "\"}"))
                .andExpect(status().isOk());

        String createResponse = mockMvc.perform(post("/api/admin/client-updates")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"%s","buildNo":"400","platform":"WINDOWS","arch":"X64","channel":"%s",
                                 "packageTempUploadId":"%s","packageSha256":"%s","packageSize":%d,
                                 "signatureStatus":"VALID","reason":"m8 e2e create"}
                                """.formatted(version, channel, seed.tempUploadId(), seed.sha256(), seed.bytes().length)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String versionId = M8TestSupport.extract(createResponse, "id");

        mockMvc.perform(post("/api/admin/client-updates/" + versionId + "/publish")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"DRAFT\",\"reason\":\"m8 e2e publish\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/client-updates/check")
                        .header("Authorization", "Bearer " + userToken)
                        .param("deviceId", deviceId)
                        .param("currentVersion", "1.0.0")
                        .param("platform", "WINDOWS")
                        .param("arch", "X64")
                        .param("channel", channel))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.versionId").value(versionId));

        String ticketResponse = mockMvc.perform(post("/api/client-updates/" + versionId + "/download-ticket")
                        .header("Authorization", "Bearer " + userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"currentVersion\":\"1.0.0\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String ticket = M8TestSupport.extract(ticketResponse, "ticket");

        byte[] downloaded = mockMvc.perform(get("/api/packages/download")
                        .header("Authorization", "Bearer " + userToken)
                        .param("ticket", ticket))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(downloaded).isEqualTo(seed.bytes());

        mockMvc.perform(get("/api/admin/audit-logs")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("deviceId", deviceId)
                        .param("action", "client_update.package_download"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].deviceId").value(deviceId));
    }
}
