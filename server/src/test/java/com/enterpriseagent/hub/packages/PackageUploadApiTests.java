package com.enterpriseagent.hub.packages;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;
import com.enterpriseagent.hub.auth.PasswordService;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@AutoConfigureMockMvc
class PackageUploadApiTests extends PostgresIntegrationTestBase {
    private static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void uploadSkillPackageStoresTempManifestPreviewAndRedactsSecrets() throws Exception {
        User user = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        MockMultipartFile file = new MockMultipartFile("file", "skill.zip", "application/zip", zip(
                entry("SKILL.md", "---\nExtensionID: demo.skill\nname: demo\ndescription: Demo desc\nversion: 1.2.3\n---\n# Demo"),
                entry("README.md", "apiKey=abcdefghijklmnopqrstuvwxyz\nhello"),
                entry("scripts/install.ps1", "Write-Host hi")));

        String response = mockMvc.perform(multipart("/api/uploads/package")
                        .file(file)
                        .param("uploadType", "SKILL_PACKAGE")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.tempUploadId").exists())
                .andExpect(jsonPath("$.data.sha256").isString())
                .andExpect(jsonPath("$.data.fileCount").value(3))
                .andExpect(jsonPath("$.data.precheck.status").value("WARNING"))
                .andExpect(jsonPath("$.data.precheck.uploadType").value("SKILL_PACKAGE"))
                .andExpect(jsonPath("$.data.precheck.definition.extensionId").value("demo.skill"))
                .andExpect(jsonPath("$.data.precheck.definition.name").value("demo"))
                .andExpect(jsonPath("$.data.precheck.definition.version").value("1.2.3"))
                .andReturn().getResponse().getContentAsString();
        String packageId = extract(response, "packageId");

        assertThat(jdbc.queryForObject("select status from temp_uploads where id = ?", String.class, UUID.fromString(packageId)))
                .isEqualTo("AVAILABLE");
        assertThat(jdbc.queryForObject("select count(*) from package_files where package_object_id = ?", Long.class,
                UUID.fromString(packageId))).isEqualTo(3L);

        mockMvc.perform(get("/api/packages/" + packageId + "/files").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[?(@.path == 'SKILL.md')]").exists())
                .andExpect(jsonPath("$.data.items[?(@.path == 'scripts/install.ps1')]").exists());
        mockMvc.perform(get("/api/packages/" + packageId + "/preview")
                        .param("path", "README.md")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content").value(org.hamcrest.Matchers.containsString("apiKey=***")))
                .andExpect(jsonPath("$.data.content").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("abcdefghijklmnopqrstuvwxyz"))));
    }

    @Test
    void uploadRejectsMissingSkillManifestAndPathTraversalWithStableCodes() throws Exception {
        User user = createUser("136" + uniqueDigits(), Role.NORMAL_USER);
        String token = login(user.getPhone(), "Temp#123456", "DESKTOP");
        mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "missing.zip", "application/zip", zip(entry("README.md", "no skill"))))
                .param("uploadType", "SKILL_PACKAGE")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("skill_manifest_missing"))
                .andExpect(jsonPath("$.error.details.uploadType").value("SKILL_PACKAGE"))
                .andExpect(jsonPath("$.error.details.requiredStructure").value("SKILL.md must be present at the zip root"));

        mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "wrapped.zip", "application/zip",
                                zip(entry("wrapped/SKILL.md", "---\nname: wrapped\n---\n# Wrapped"))))
                .param("uploadType", "SKILL_PACKAGE")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("skill_manifest_missing"))
                .andExpect(jsonPath("$.error.details.definition").doesNotExist());

        mockMvc.perform(multipart("/api/uploads/package")
                        .file(new MockMultipartFile("file", "bad.zip", "application/zip", zip(entry("../evil.txt", "bad"))))
                        .param("uploadType", "SKILL_PACKAGE")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("package_path_traversal"));
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
        User user = new User("测试用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode("Temp#123456"), PasswordService.ALGORITHM, ROOT_DEPARTMENT_ID, role);
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
        JsonNode data = new ObjectMapper().readTree(response).path("data");
        if (data.has(field)) {
            return data.path(field).asText();
        }
        throw new IllegalArgumentException("Field not found: " + field);
    }

    private String uniqueDigits() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    private record ZipContent(String name, String content) {}
}
