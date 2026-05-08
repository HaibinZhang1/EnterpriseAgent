package com.enterpriseagent.hub.extension;

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
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;
import com.enterpriseagent.hub.auth.PasswordService;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.auth.UserStatus;

@AutoConfigureMockMvc
class ExtensionDefinitionApiTests extends PostgresIntegrationTestBase {
    private static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void mcpDefinitionReturnsAuthorizedTemplateWithoutSecrets() throws Exception {
        User user = createUser();
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        String extensionId = "mcp-definition-" + uniqueDigits();
        UUID extensionPk = createPublished(extensionId, ExtensionType.MCP_SERVER, user.getId(), VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN);
        jdbc.update("""
                insert into mcp_definitions (id, extension_pk, access_type, transport, config_schema)
                values (?, ?, 'REMOTE_HTTP', 'STREAMABLE_HTTP',
                  '{"endpointTemplate":"https://finance.internal/mcp","variablesSchema":[{"name":"apiKey","sensitive":true}],"configTemplate":{"server":"finance"},"connectionTest":{"type":"HTTP_HEALTH","target":"https://finance.internal/health"},"sampleSecret":"must-not-leak"}'::jsonb)
                """, UUID.randomUUID(), extensionPk);

        String body = mockMvc.perform(get("/api/extensions/" + extensionId + "/mcp-definition")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.extensionId").value(extensionId))
                .andExpect(jsonPath("$.data.accessType").value("REMOTE_HTTP"))
                .andExpect(jsonPath("$.data.transport").value("STREAMABLE_HTTP"))
                .andExpect(jsonPath("$.data.variablesSchema[0].sensitive").value(true))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("must-not-leak");
    }

    @Test
    void pluginDefinitionReturnsManifestButDoesNotBypassDownloadTickets() throws Exception {
        User user = createUser();
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        String extensionId = "plugin-definition-" + uniqueDigits();
        UUID extensionPk = createPublished(extensionId, ExtensionType.PLUGIN, user.getId(), VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN);
        jdbc.update("""
                insert into plugin_definitions (id, extension_pk, install_mode, target_tools, manifest)
                values (?, ?, 'MANUAL_DOWNLOAD', '["codex"]'::jsonb,
                  '{"manualInstallDoc":"Install manually","manualUninstallDoc":"Remove manually","externalDownload":{"sourceSystem":"internal-artifact-repo","urlPreview":"https://artifact.internal/...","sha256":"abc123","size":123}}'::jsonb)
                """, UUID.randomUUID(), extensionPk);

        String body = mockMvc.perform(get("/api/extensions/" + extensionId + "/plugin-definition")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.extensionId").value(extensionId))
                .andExpect(jsonPath("$.data.installMode").value("MANUAL_DOWNLOAD"))
                .andExpect(jsonPath("$.data.requiresDownloadTicketPurpose").value("MANUAL_DOWNLOAD"))
                .andExpect(jsonPath("$.data.externalDownload.sha256").value("abc123"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).contains("manualInstallDoc").doesNotContain("packageBytes");
    }

    @Test
    void definitionEndpointsRejectUnauthorizedScopeAndWrongTypes() throws Exception {
        User user = createUser();
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        String restrictedId = "restricted-mcp-" + uniqueDigits();
        UUID restrictedPk = createPublished(restrictedId, ExtensionType.MCP_SERVER, adminId(), VisibilityMode.AUTHORIZED_ONLY);
        jdbc.update("delete from extension_authorization_scopes where extension_pk = ?", restrictedPk);
        String skillId = "wrong-type-skill-" + uniqueDigits();
        createPublished(skillId, ExtensionType.SKILL, user.getId(), VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN);

        mockMvc.perform(get("/api/extensions/" + restrictedId + "/mcp-definition")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("scope_restricted"));
        mockMvc.perform(get("/api/extensions/" + skillId + "/mcp-definition")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("resource_not_found"));
    }

    private UUID createPublished(String extensionId, ExtensionType type, UUID authorId, VisibilityMode visibilityMode) {
        UUID id = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        jdbc.update("""
                insert into extensions (id, extension_id, type, name, description, category, tags, status,
                  visibility_mode, owner_department_id, maintainer_id, author_id, current_version_id,
                  current_version, risk_level, risk_summary)
                values (?, ?, ?, ?, ?, 'test', '[\"test\"]'::jsonb, 'PUBLISHED', ?, ?, ?, ?, ?, '1.0.0', 'LOW', 'seed')
                """, id, extensionId, type.name(), extensionId, extensionId + " description",
                visibilityMode.name(), ROOT_DEPARTMENT_ID, authorId, authorId, versionId);
        jdbc.update("""
                insert into extension_versions (id, extension_pk, version, status, payload_snapshot, package_snapshot, changelog, published_at)
                values (?, ?, '1.0.0', 'PUBLISHED', '{"schemaVersion":1,"source":"seed","data":{}}'::jsonb,
                  '{"schemaVersion":1,"source":"seed","data":{"mode":"PLACEHOLDER"}}'::jsonb, 'seed', now())
                """, versionId, id);
        UUID scopeId = UUID.randomUUID();
        jdbc.update("insert into extension_authorization_scopes (id, extension_pk, scope_type) values (?, ?, 'ALL_EMPLOYEES')",
                scopeId, id);
        return id;
    }

    private User createUser() {
        String phone = "137" + uniqueDigits();
        User user = new User("测试用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode("Temp#123456"), PasswordService.ALGORITHM, ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
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
}
