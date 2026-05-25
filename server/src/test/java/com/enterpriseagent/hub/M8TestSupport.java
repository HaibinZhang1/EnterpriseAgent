package com.enterpriseagent.hub;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.UUID;

import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.auth.PasswordService;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

final class M8TestSupport {
    static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private M8TestSupport() {
    }

    static User createUser(UserRepository repository, String phone, Role role) {
        User user = new User("M8用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode("Temp#123456"), PasswordService.ALGORITHM, ROOT_DEPARTMENT_ID, role);
        user.setMustChangePassword(false);
        return repository.save(user);
    }

    static String login(MockMvc mockMvc, String phone, String password, String clientType, String deviceId) throws Exception {
        String body = "{\"phone\":\"" + phone + "\",\"password\":\"" + password + "\",\"clientType\":\""
                + clientType + "\",\"deviceId\":\"" + deviceId + "\"}";
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return extract(response, "token");
    }

    static String extract(String response, String field) throws Exception {
        JsonNode data = OBJECT_MAPPER.readTree(response).path("data");
        if (!data.has(field)) {
            throw new IllegalArgumentException("Field not found: " + field + " in " + response);
        }
        return data.path(field).asText();
    }

    static SeededUpdatePackage seedClientUpdatePackage(JdbcTemplate jdbc, UUID createdBy, String content) throws Exception {
        UUID id = UUID.randomUUID();
        byte[] bytes = content.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String sha256 = sha256(bytes);
        Path temp = Files.createTempFile("eah-client-update-", ".zip");
        Files.write(temp, bytes);
        jdbc.update("""
                insert into temp_uploads (id, upload_type, original_filename, content_type, temp_path, sha256,
                  size_bytes, file_count, precheck_status, precheck_result, created_by, expires_at, status)
                values (?, 'CLIENT_UPDATE_PACKAGE', 'agent-update.zip', 'application/zip', ?, ?, ?, 1,
                  'PASSED', '{}'::jsonb, ?, ?, 'AVAILABLE')
                """, id, temp.toString(), sha256, bytes.length, createdBy, OffsetDateTime.now().plusHours(1));
        jdbc.update("""
                insert into package_objects (id, object_type, sha256, storage_path, original_filename, size_bytes,
                  uncompressed_size_bytes, file_count, precheck_status, risk_level, risk_summary,
                  source_temp_upload_id, created_by)
                values (?, 'TEMP_UPLOAD', ?, ?, 'agent-update.zip', ?, ?, 1, 'PASSED', 'LOW', '{}'::jsonb, ?, ?)
                """, id, sha256, temp.toString(), bytes.length, bytes.length, id, createdBy);
        return new SeededUpdatePackage(id, sha256, bytes);
    }

    static String uniquePhone(String prefix) {
        return prefix + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    record SeededUpdatePackage(UUID tempUploadId, String sha256, byte[] bytes) {
    }
}
