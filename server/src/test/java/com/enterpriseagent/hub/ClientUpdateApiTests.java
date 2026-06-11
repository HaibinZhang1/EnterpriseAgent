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
class ClientUpdateApiTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void publishedClientUpdateCanBeCheckedTicketedDownloadedAndAuditedWithoutExtensionMetricPollution() throws Exception {
        UUID adminId = jdbc.queryForObject("select id from users where phone = '13800000000'", UUID.class);
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-update");
        M8TestSupport.SeededUpdatePackage seed = M8TestSupport.seedClientUpdatePackage(jdbc, adminId,
                "m8 client update package " + UUID.randomUUID());
        String version = "2." + System.nanoTime() + ".0";
        String channel = "M8TEST" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();

        String createResponse = mockMvc.perform(post("/api/admin/client-updates")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"%s","buildNo":"200","platform":"WINDOWS","arch":"X64","channel":"%s",
                                 "forceUpdate":false,"packageTempUploadId":"%s","packageSha256":"%s","packageSize":%d,
                                 "signatureStatus":"VALID","certificateSummary":{"subject":"CN=Enterprise Agent"},"reason":"m8 test"}
                                """.formatted(version, channel, seed.tempUploadId(), seed.sha256(), seed.bytes().length)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DRAFT"))
                .andReturn().getResponse().getContentAsString();
        String versionId = M8TestSupport.extract(createResponse, "id");

        mockMvc.perform(post("/api/admin/client-updates/" + versionId + "/publish")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"DRAFT\",\"reason\":\"publish for m8\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PUBLISHED"));

        User user = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("137"), Role.NORMAL_USER);
        String deviceId = "m8-update-device-" + UUID.randomUUID();
        String userToken = M8TestSupport.login(mockMvc, user.getPhone(), "Temp#123456", "DESKTOP", deviceId);
        mockMvc.perform(post("/api/client-devices/register")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Client-Version", "1.0.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"clientVersion\":\"1.0.0\",\"arch\":\"X64\",\"installChannel\":\"" + channel + "\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/client-updates/events")
                        .header("Authorization", "Bearer " + userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"deviceId":"%s","events":[
                                  {"idempotencyKey":"updated-first-start-%s","eventType":"UPDATED_FIRST_START","result":"SUCCESS",
                                   "fromVersion":"1.0.0","toVersion":"%s","payloadSummary":{"phase":"first-start"}}
                                ]}
                                """.formatted(deviceId, versionId, version)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].status").value("ACCEPTED"));

        mockMvc.perform(get("/api/client-updates/check")
                        .header("Authorization", "Bearer " + userToken)
                        .param("deviceId", deviceId)
                        .param("currentVersion", "1.0.0")
                        .param("platform", "win32")
                        .param("arch", "x64")
                        .param("channel", channel))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.updateAvailable").value(true))
                .andExpect(jsonPath("$.data.versionId").value(versionId))
                .andExpect(jsonPath("$.data.downloadTicketRequired").value(true));

        String ticketResponse = mockMvc.perform(post("/api/client-updates/" + versionId + "/download-ticket")
                        .header("Authorization", "Bearer " + userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"currentVersion\":\"1.0.0\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ticket").isString())
                .andExpect(jsonPath("$.data.purpose").value("CLIENT_UPDATE"))
                .andReturn().getResponse().getContentAsString();
        String ticket = M8TestSupport.extract(ticketResponse, "ticket");
        String ticketId = M8TestSupport.extract(ticketResponse, "ticketId");

        byte[] downloaded = mockMvc.perform(get("/api/packages/download")
                        .param("ticket", ticket)
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(downloaded).isEqualTo(seed.bytes());

        assertThat(jdbc.queryForObject("select count(*) from client_update_events where device_id = ? and event_type = 'DOWNLOAD_STARTED'",
                Long.class, deviceId)).isEqualTo(1L);
        assertThat(jdbc.queryForObject("select count(*) from activity_events where payload->>'ticketId' = ?", Long.class, ticketId))
                .isZero();

        mockMvc.perform(post("/api/client-updates/events")
                        .header("Authorization", "Bearer " + userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"versionId":"%s","deviceId":"%s","eventType":"HASH_FAILED","result":"FAILURE","errorCode":"hash_mismatch","fromVersion":"1.0.0","toVersion":"%s","payloadSummary":{"phase":"verify"}}
                                """.formatted(versionId, deviceId, version)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(true));

        mockMvc.perform(get("/api/admin/client-updates/events")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("deviceId", deviceId)
                        .param("errorCode", "hash_mismatch"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].error_code").value("hash_mismatch"));
        assertThat(jdbc.queryForObject("""
                select count(*) from client_update_events
                 where device_id = ? and event_type = 'UPDATED_FIRST_START' and from_version = '1.0.0' and to_version = ?
                """, Long.class, deviceId, version)).isEqualTo(1L);

        mockMvc.perform(post("/api/admin/client-updates/" + versionId + "/pause")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"PUBLISHED\",\"reason\":\"pause for m8\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PAUSED"));

        mockMvc.perform(post("/api/admin/client-updates/" + versionId + "/publish")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"PAUSED\",\"reason\":\"republish for m8\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PUBLISHED"));

        mockMvc.perform(post("/api/admin/client-updates/" + versionId + "/withdraw")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"PUBLISHED\",\"reason\":\"withdraw for m8\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("WITHDRAWN"));
    }

    @Test
    void clientUpdateEventsNormalizeFailureResultsAndRejectSuccessWithErrorCode() throws Exception {
        User user = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("137"), Role.NORMAL_USER);
        String deviceId = "m8-update-event-device-" + UUID.randomUUID();
        String userToken = M8TestSupport.login(mockMvc, user.getPhone(), "Temp#123456", "DESKTOP", deviceId);
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-update-events");
        mockMvc.perform(post("/api/client-devices/register")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Client-Version", "1.0.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"clientVersion\":\"1.0.0\",\"arch\":\"X64\",\"installChannel\":\"STABLE\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/client-updates/events")
                        .header("Authorization", "Bearer " + userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"deviceId":"%s","events":[
                                  {"idempotencyKey":"event-failure-%s","eventType":"DOWNLOAD_FAILED","errorCode":"network_error"},
                                  {"idempotencyKey":"event-invalid-%s","eventType":"VERIFY_FAILED","result":"SUCCESS","errorCode":"hash_mismatch"},
                                  {"idempotencyKey":"event-cancelled-%s","eventType":"USER_CANCELLED","result":"cancelled"}
                                ]}
                                """.formatted(deviceId, deviceId, deviceId, deviceId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].status").value("ACCEPTED"))
                .andExpect(jsonPath("$.data.results[0].result").value("FAILURE"))
                .andExpect(jsonPath("$.data.results[0].errorCode").value("network_error"))
                .andExpect(jsonPath("$.data.results[0].serverEventId").isString())
                .andExpect(jsonPath("$.data.results[1].status").value("REJECTED"))
                .andExpect(jsonPath("$.data.results[1].result").value("SUCCESS"))
                .andExpect(jsonPath("$.data.results[1].errorCode").value("invalid_result"))
                .andExpect(jsonPath("$.data.results[2].status").value("ACCEPTED"))
                .andExpect(jsonPath("$.data.results[2].result").value("CANCELLED"));

        mockMvc.perform(get("/api/admin/client-updates/events")
                        .header("Authorization", "Bearer " + adminToken)
                        .param("deviceId", deviceId)
                        .param("result", "FAILURE"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].event_type").value("DOWNLOAD_FAILED"))
                .andExpect(jsonPath("$.data.items[0].result").value("FAILURE"));

        assertThat(jdbc.queryForObject("""
                select count(*) from client_update_events
                 where device_id = ? and event_type = 'VERIFY_FAILED'
                """, Long.class, deviceId)).isZero();
    }

    @Test
    void invalidSignatureClientUpdateCannotBePublished() throws Exception {
        UUID adminId = jdbc.queryForObject("select id from users where phone = '13800000000'", UUID.class);
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-invalid-update");
        M8TestSupport.SeededUpdatePackage seed = M8TestSupport.seedClientUpdatePackage(jdbc, adminId,
                "m8 invalid client update package " + UUID.randomUUID());
        String createResponse = mockMvc.perform(post("/api/admin/client-updates")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"3.%d.0","buildNo":"300","platform":"WINDOWS","arch":"X64","channel":"BETA",
                                 "packageTempUploadId":"%s","packageSha256":"%s","packageSize":%d,
                                 "signatureStatus":"INVALID","reason":"m8 invalid signature test"}
                                """.formatted(System.nanoTime(), seed.tempUploadId(), seed.sha256(), seed.bytes().length)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String versionId = M8TestSupport.extract(createResponse, "id");

        mockMvc.perform(post("/api/admin/client-updates/" + versionId + "/publish")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"DRAFT\",\"reason\":\"should fail\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("signature_invalid"));
    }

    @Test
    void malformedClientUpdatePackageUploadIdReturnsValidationError() throws Exception {
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB",
                "admin-malformed-update-upload");

        mockMvc.perform(post("/api/admin/client-updates")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"3.%d.0","buildNo":"300","platform":"WINDOWS","arch":"X64","channel":"BETA",
                                 "packageTempUploadId":"missing-temp-upload-for-negative-smoke","packageSha256":"%s","packageSize":1,
                                 "signatureStatus":"VALID","reason":"browser negative smoke"}
                                """.formatted(System.nanoTime(), "0".repeat(64))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void nonNumericClientUpdatePackageSizeReturnsValidationError() throws Exception {
        UUID adminId = jdbc.queryForObject("select id from users where phone = '13800000000'", UUID.class);
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB",
                "admin-nonnumeric-update-size");
        M8TestSupport.SeededUpdatePackage seed = M8TestSupport.seedClientUpdatePackage(jdbc, adminId,
                "m8 nonnumeric client update package " + UUID.randomUUID());

        mockMvc.perform(post("/api/admin/client-updates")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"3.%d.0","buildNo":"300","platform":"WINDOWS","arch":"X64","channel":"BETA",
                                 "packageTempUploadId":"%s","packageSha256":"%s","packageSize":"not-a-number",
                                 "signatureStatus":"VALID","reason":"browser numeric validation smoke"}
                                """.formatted(System.nanoTime(), seed.tempUploadId(), seed.sha256())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void updateCheckFiltersPlatformAndUsesSemanticVersionOrdering() throws Exception {
        UUID adminId = jdbc.queryForObject("select id from users where phone = '13800000000'", UUID.class);
        String adminToken = M8TestSupport.login(mockMvc, "13800000000", "Admin#123456", "ADMIN_WEB", "admin-semver-update");
        String channel = "SEMVER" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
        M8TestSupport.SeededUpdatePackage windowsSeed = M8TestSupport.seedClientUpdatePackage(jdbc, adminId,
                "m8 windows semantic update " + UUID.randomUUID());
        String windowsCreateResponse = mockMvc.perform(post("/api/admin/client-updates")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"1.10.0","buildNo":"110","platform":"WINDOWS","arch":"X64","channel":"%s",
                                 "packageTempUploadId":"%s","packageSha256":"%s","packageSize":%d,
                                 "signatureStatus":"VALID","reason":"semantic version test"}
                                """.formatted(channel, windowsSeed.tempUploadId(), windowsSeed.sha256(), windowsSeed.bytes().length)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String windowsVersionId = M8TestSupport.extract(windowsCreateResponse, "id");
        mockMvc.perform(post("/api/admin/client-updates/" + windowsVersionId + "/publish")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"DRAFT\",\"reason\":\"publish semantic version\"}"))
                .andExpect(status().isOk());

        M8TestSupport.SeededUpdatePackage macSeed = M8TestSupport.seedClientUpdatePackage(jdbc, adminId,
                "m8 mac platform update " + UUID.randomUUID());
        String macCreateResponse = mockMvc.perform(post("/api/admin/client-updates")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"9.0.0","buildNo":"900","platform":"MACOS","arch":"X64","channel":"%s",
                                 "packageTempUploadId":"%s","packageSha256":"%s","packageSize":%d,
                                 "signatureStatus":"VALID","reason":"platform filter test"}
                                """.formatted(channel, macSeed.tempUploadId(), macSeed.sha256(), macSeed.bytes().length)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String macVersionId = M8TestSupport.extract(macCreateResponse, "id");
        mockMvc.perform(post("/api/admin/client-updates/" + macVersionId + "/publish")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedStatus\":\"DRAFT\",\"reason\":\"publish mac version\"}"))
                .andExpect(status().isOk());

        User user = M8TestSupport.createUser(userRepository, M8TestSupport.uniquePhone("137"), Role.NORMAL_USER);
        String deviceId = "m8-semver-device-" + UUID.randomUUID();
        String userToken = M8TestSupport.login(mockMvc, user.getPhone(), "Temp#123456", "DESKTOP", deviceId);
        mockMvc.perform(post("/api/client-devices/register")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Client-Version", "1.2.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"clientVersion\":\"1.2.0\",\"arch\":\"X64\",\"installChannel\":\"" + channel + "\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/client-updates/check")
                        .header("Authorization", "Bearer " + userToken)
                        .param("deviceId", deviceId)
                        .param("currentVersion", "1.2.0")
                        .param("platform", "WINDOWS")
                        .param("arch", "X64")
                        .param("channel", channel))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.updateAvailable").value(true))
                .andExpect(jsonPath("$.data.versionId").value(windowsVersionId));

        mockMvc.perform(get("/api/client-updates/check")
                        .header("Authorization", "Bearer " + userToken)
                        .param("deviceId", deviceId)
                        .param("currentVersion", "1.2.0")
                        .param("platform", "LINUX")
                        .param("arch", "X64")
                        .param("channel", channel))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.updateAvailable").value(false));
    }
}
