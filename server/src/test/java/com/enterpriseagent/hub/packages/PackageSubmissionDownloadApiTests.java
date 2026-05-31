package com.enterpriseagent.hub.packages;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;
import com.enterpriseagent.hub.auth.PasswordService;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.organization.Department;
import com.enterpriseagent.hub.organization.DepartmentRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@AutoConfigureMockMvc
class PackageSubmissionDownloadApiTests extends PostgresIntegrationTestBase {
    private static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private DepartmentRepository departmentRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void uploadSubmitApproveIssueTicketDownloadAndDoNotPersistPlaintextTicket() throws Exception {
        User user = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String userToken = login(user.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        byte[] zip = zip(entry("SKILL.md", "---\nname: downloadable\n---\n# Downloadable"), entry("README.md", "hello"));

        String uploadResponse = mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "downloadable.zip", "application/zip", zip))
                        .param("uploadType", "SKILL_PACKAGE")
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.tempUploadId").exists())
                .andReturn().getResponse().getContentAsString();
        String tempUploadId = extract(uploadResponse, "tempUploadId");
        String sha256 = extract(uploadResponse, "sha256");
        String extensionId = "pkg-download-" + uniqueDigits();

        String createResponse = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + userToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId, tempUploadId, sha256)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String submissionId = extract(createResponse, "submissionId");
        String revisionId = extract(createResponse, "revisionId");
        assertThat(jdbc.queryForObject("select status from temp_uploads where id = ?", String.class, UUID.fromString(tempUploadId)))
                .isEqualTo("CONSUMED");
        assertThat(jdbc.queryForObject("select package_snapshot->'data'->>'packageStorageStatus' from submission_revisions where id = ?",
                String.class, UUID.fromString(revisionId))).isEqualTo("CONSUMED");

        mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + userToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(extensionId + "-reuse", tempUploadId, sha256)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("upload_already_consumed"));

        mockMvc.perform(post("/api/reviews/tasks/" + submissionId + "/approve")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + revisionId + "\",\"comment\":\"ok\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("APPROVED"));

        String issueResponse = mockMvc.perform(post("/api/download-tickets")
                        .header("Authorization", "Bearer " + userToken)
                        .header("Idempotency-Key", "ticket-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"objectType\":\"EXTENSION_PACKAGE\",\"extensionId\":\"" + extensionId +
                                "\",\"purpose\":\"INSTALL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ticket").isString())
                .andExpect(jsonPath("$.data.downloadUrl").isString())
                .andReturn().getResponse().getContentAsString();
        String ticket = extract(issueResponse, "ticket");
        assertThat(jdbc.queryForObject("select count(*) from download_tickets where ticket_hash = ?", Long.class, ticket))
                .isZero();
        String snapshot = jdbc.queryForObject("select response_snapshot::text from idempotency_records where operation = 'download-ticket.issue' order by created_at desc limit 1", String.class);
        assertThat(snapshot).doesNotContain(ticket).doesNotContain("downloadUrl").contains("credentialReplayPolicy");

        byte[] downloaded = mockMvc.perform(get("/api/packages/download").param("ticket", ticket)
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(downloaded).isEqualTo(zip);
        assertThat(jdbc.queryForObject("select count(*) from activity_events where event_type = 'EXTENSION_DOWNLOAD'", Long.class))
                .isGreaterThanOrEqualTo(1L);

        mockMvc.perform(get("/api/packages/download").param("ticket", ticket)
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("download_ticket_used"));
    }

    @Test
    void publicVisibleButUnauthorizedExtensionCannotIssueInstallDownloadTicket() throws Exception {
        Department authorizedDepartment = departmentRepository.save(new Department("authorized" + uniqueDigits(), ROOT_DEPARTMENT_ID));
        User publisher = createUser("136" + uniqueDigits(), Role.NORMAL_USER, authorizedDepartment.getId());
        User outsideUser = createUser("136" + uniqueDigits(), Role.NORMAL_USER, ROOT_DEPARTMENT_ID);
        String publisherToken = login(publisher.getPhone(), "Temp#123456", "DESKTOP");
        String outsideToken = login(outsideUser.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        byte[] zip = zip(entry("SKILL.md", "---\nname: restricted-download\n---\n# Restricted Download"));

        String uploadResponse = mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "restricted-download.zip", "application/zip", zip))
                        .param("uploadType", "SKILL_PACKAGE")
                        .header("Authorization", "Bearer " + publisherToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String extensionId = "restricted-download-" + uniqueDigits();
        String scope = """
                {"scopeType":"SELECTED_DEPARTMENTS","departments":[{"departmentId":"%s","includeChildren":false}]}
                """.formatted(authorizedDepartment.getId());
        String createResponse = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + publisherToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBodyWithScope(extensionId, extract(uploadResponse, "tempUploadId"),
                                extract(uploadResponse, "sha256"), scope)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String submissionId = extract(createResponse, "submissionId");
        String revisionId = extract(createResponse, "revisionId");

        mockMvc.perform(post("/api/reviews/tasks/" + submissionId + "/approve")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + revisionId + "\",\"comment\":\"ok\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/download-tickets")
                        .header("Authorization", "Bearer " + outsideToken)
                        .header("Idempotency-Key", "ticket-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"objectType\":\"EXTENSION_PACKAGE\",\"extensionId\":\"" + extensionId +
                                "\",\"purpose\":\"INSTALL\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("scope_restricted"));
        mockMvc.perform(post("/api/download-tickets")
                        .header("Authorization", "Bearer " + publisherToken)
                        .header("Idempotency-Key", "ticket-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"objectType\":\"EXTENSION_PACKAGE\",\"extensionId\":\"" + extensionId +
                                "\",\"purpose\":\"INSTALL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ticket").isString());
    }

    @Test
    void mcpAndPluginManifestValidatorsReturnStableCodes() throws Exception {
        User user = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "mcp.zip", "application/zip", zip(entry("mcp.json",
                                "{\"serverName\":\"demo\",\"version\":\"1.0.0\",\"accessType\":\"remote-http\",\"transport\":\"http\",\"endpoint\":\"https://example.invalid/mcp\"}"))))
                        .param("uploadType", "MCP_MANIFEST")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
        mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "bad-mcp.zip", "application/zip", zip(entry("mcp.json",
                                "{\"serverName\":\"demo\",\"version\":\"1.0.0\",\"accessType\":\"remote-http\",\"transport\":\"stdio\",\"endpoint\":\"https://example.invalid/mcp\"}"))))
                        .param("uploadType", "MCP_MANIFEST")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("mcp_transport_invalid"));
        mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "plugin.zip", "application/zip", zip(entry("plugin.json", "{\"pluginName\":\"demo\"}"))))
                        .param("uploadType", "PLUGIN_MANIFEST")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("plugin_manifest_invalid"));
    }

    @Test
    void approvalMaterializesMcpAndPluginDefinitionsFromUploadedManifests() throws Exception {
        User user = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String userToken = login(user.getPhone(), "Temp#123456", "DESKTOP");
        String adminToken = login("13800000000", "Admin#123456", "ADMIN_WEB");
        String mcpUpload = mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "mcp.zip", "application/zip", zip(entry("mcp.json", """
                                {"serverName":"finance","version":"1.0.0","accessType":"remote-http","transport":"http","endpoint":"https://example.invalid/mcp","variablesSchema":[{"name":"apiKey","sensitive":true}],"configTemplate":{"server":"finance"},"connectionTest":{"type":"HTTP_HEALTH","target":"https://example.invalid/health"}}
                                """))))
                        .param("uploadType", "MCP_MANIFEST")
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String mcpId = "mcp-materialized-" + uniqueDigits();
        String mcpCreate = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + userToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(mcpId, "MCP_SERVER", extract(mcpUpload, "tempUploadId"), extract(mcpUpload, "sha256"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        approve(adminToken, extract(mcpCreate, "submissionId"), extract(mcpCreate, "revisionId"));
        mockMvc.perform(get("/api/extensions/" + mcpId + "/mcp-definition")
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.transport").value("streamable-http"))
                .andExpect(jsonPath("$.data.endpointTemplate").value("https://example.invalid/mcp"))
                .andExpect(jsonPath("$.data.variablesSchema[0].name").value("apiKey"));

        String pluginUpload = mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "plugin.zip", "application/zip", zip(entry("plugin.json", """
                                {"pluginName":"demo-plugin","version":"1.0.0","installMode":"config-plugin","targetTools":["codex"],"manualInstallDoc":"Install manually","manualUninstallDoc":"Remove manually"}
                                """))))
                        .param("uploadType", "PLUGIN_MANIFEST")
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String pluginId = "plugin-materialized-" + uniqueDigits();
        String pluginCreate = mockMvc.perform(post("/api/submissions")
                        .header("Authorization", "Bearer " + userToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(submissionBody(pluginId, "PLUGIN", extract(pluginUpload, "tempUploadId"),
                                extract(pluginUpload, "sha256"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        approve(adminToken, extract(pluginCreate, "submissionId"), extract(pluginCreate, "revisionId"));
        mockMvc.perform(get("/api/extensions/" + pluginId + "/plugin-definition")
                        .header("Authorization", "Bearer " + userToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.installMode").value("CONFIG_PLUGIN"))
                .andExpect(jsonPath("$.data.targetTools[0]").value("codex"))
                .andExpect(jsonPath("$.data.manualInstallDoc").value("Install manually"));
    }

    private String submissionBody(String extensionId, String tempUploadId, String sha256) {
        return submissionBody(extensionId, "SKILL", tempUploadId, sha256);
    }

    private String submissionBody(String extensionId, String extensionType, String tempUploadId, String sha256) {
        return submissionBody(extensionId, extensionType, tempUploadId, sha256,
                "{\"scopeType\":\"ALL_EMPLOYEES\",\"departments\":[]}");
    }

    private String submissionBodyWithScope(String extensionId, String tempUploadId, String sha256, String authorizationScope) {
        return submissionBody(extensionId, "SKILL", tempUploadId, sha256, authorizationScope);
    }

    private String submissionBody(String extensionId, String extensionType, String tempUploadId, String sha256,
            String authorizationScope) {
        return """
                {
                  "type":"FIRST_PUBLISH",
                  "extensionType":"%s",
                  "extensionId":"%s",
                  "version":"1.0.0",
                  "metadata":{"name":"%s","description":"desc","category":"dev","tags":["test"],"changeLog":"init"},
                  "authorizationScope":%s,
                  "visibilityMode":"PUBLIC_TO_ALL_LOGGED_IN",
                  "riskStatement":{"summary":"low"},
                  "typePayload":{},
                  "uploadRefs":[{"tempUploadId":"%s","sha256":"%s"}]
                }
                """.formatted(extensionType, extensionId, extensionId, authorizationScope, tempUploadId, sha256);
    }

    private byte[] zip(ZipContent... contents) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            for (ZipContent content : contents) {
                out.putNextEntry(new ZipEntry(content.name()));
                out.write(content.content().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private ZipContent entry(String name, String content) {
        return new ZipContent(name, content);
    }

    private User createUser(String phone, Role role) {
        return createUser(phone, role, ROOT_DEPARTMENT_ID);
    }

    private User createUser(String phone, Role role, UUID departmentId) {
        User user = new User("测试用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode("Temp#123456"), PasswordService.ALGORITHM, departmentId, role);
        user.setMustChangePassword(false);
        return userRepository.save(user);
    }

    private String login(String phone, String password, String clientType) throws Exception {
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"" + phone + "\",\"password\":\"" + password + "\",\"clientType\":\"" + clientType + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return response.replaceAll(".*\"token\":\"([^\"]+)\".*", "$1");
    }

    private String extract(String response, String field) throws Exception {
        JsonNode data = objectMapper.readTree(response).path("data");
        if (data.has(field)) {
            return data.path(field).asText();
        }
        throw new IllegalArgumentException("Field not found: " + field);
    }

    private void approve(String adminToken, String submissionId, String revisionId) throws Exception {
        mockMvc.perform(post("/api/reviews/tasks/" + submissionId + "/approve")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"revisionId\":\"" + revisionId + "\",\"comment\":\"ok\"}"))
                .andExpect(status().isOk());
    }

    private String uniqueDigits() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    private record ZipContent(String name, String content) {}
}
