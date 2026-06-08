package com.enterpriseagent.hub.packages;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.common.audit.AuditRecord;
import com.enterpriseagent.hub.common.audit.AuditResult;
import com.enterpriseagent.hub.common.audit.AuditService;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.extension.ExtensionJson;
import com.enterpriseagent.hub.extension.ExtensionType;

@Service
public class PackageUploadService {
    private final PackageStorageService storageService;
    private final SafeZipExtractor safeZipExtractor;
    private final PackageStorageProperties properties;
    private final JdbcTemplate jdbc;
    private final ExtensionJson json;
    private final AuditService auditService;

    public PackageUploadService(PackageStorageService storageService, SafeZipExtractor safeZipExtractor,
            PackageStorageProperties properties, JdbcTemplate jdbc, ExtensionJson json, AuditService auditService) {
        this.storageService = storageService;
        this.safeZipExtractor = safeZipExtractor;
        this.properties = properties;
        this.jdbc = jdbc;
        this.json = json;
        this.auditService = auditService;
    }

    @Transactional
    public Map<String, Object> upload(CurrentUser actor, UploadType uploadType, MultipartFile file) {
        UUID tempUploadId = UUID.randomUUID();
        var stored = storageService.writeTemp(tempUploadId, file);
        SafeZipExtractResult result = safeZipExtractor.scan(stored.path(), stored.sha256(), stored.size());
        if (!result.rejected() && uploadType == UploadType.SKILL_PACKAGE
                && result.files().stream().noneMatch(item -> "SKILL.md".equals(item.path()))) {
            result = new SafeZipExtractResult(stored.sha256(), stored.size(), result.uncompressedSize(), result.fileCount(),
                    result.files(), result.findings(), result.previews(), true, "skill_manifest_missing");
        }
        if (!result.rejected() && uploadType == UploadType.MCP_MANIFEST) {
            result = validateMcpManifest(stored, result);
        }
        if (!result.rejected() && (uploadType == UploadType.PLUGIN_PACKAGE || uploadType == UploadType.PLUGIN_MANIFEST)) {
            result = validatePluginManifest(stored, result);
        }
        if (result.rejected()) {
            persistRejectedTemp(actor, uploadType, stored, result);
            throw new BusinessException(errorCode(result.rejectCode()), rejectMessage(result.rejectCode()), precheckEnvelope(result, uploadType));
        }
        persistAvailableTemp(actor, tempUploadId, uploadType, stored, result, file.getContentType());
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .objectType("package")
                .objectId(tempUploadId.toString())
                .objectNameSnapshot(stored.originalFilename())
                .action("package.upload")
                .result(AuditResult.SUCCESS)
                .afterSummary(Map.of("schemaVersion", 1, "tempUploadId", tempUploadId, "sha256", stored.sha256(),
                        "precheckStatus", result.status().name()))
                .build());
        return response(tempUploadId, uploadType, stored, result);
    }

    private void persistRejectedTemp(CurrentUser actor, UploadType uploadType, PackageStorageService.StoredTempFile stored,
            SafeZipExtractResult result) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into temp_uploads (id, upload_type, original_filename, content_type, temp_path, sha256, size_bytes,
                  file_count, precheck_status, precheck_result, created_by, expires_at, status)
                values (?, ?, ?, ?, ?, ?, ?, ?, 'FAILED', ?::jsonb, ?, ?, 'REJECTED')
                """, id, uploadType.name(), stored.originalFilename(), null, stored.path().toString(), stored.sha256(),
                stored.size(), 0, json.write(precheckEnvelope(result, uploadType)), actor.id(), OffsetDateTime.now().plus(properties.getTempTtl()));
    }

    private void persistAvailableTemp(CurrentUser actor, UUID tempUploadId, UploadType uploadType,
            PackageStorageService.StoredTempFile stored, SafeZipExtractResult result, String contentType) {
        String precheck = json.write(precheckEnvelope(result, uploadType));
        OffsetDateTime expiresAt = OffsetDateTime.now().plus(properties.getTempTtl());
        jdbc.update("""
                insert into temp_uploads (id, upload_type, original_filename, content_type, temp_path, sha256, size_bytes,
                  file_count, precheck_status, precheck_result, created_by, expires_at, status)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, 'AVAILABLE')
                """, tempUploadId, uploadType.name(), stored.originalFilename(), contentType, stored.path().toString(),
                stored.sha256(), stored.size(), result.fileCount(), result.status().name(), precheck, actor.id(), expiresAt);
        jdbc.update("""
                insert into package_objects (id, object_type, sha256, storage_path, original_filename, size_bytes,
                  uncompressed_size_bytes, file_count, precheck_status, risk_level, risk_summary, source_temp_upload_id, created_by)
                values (?, 'TEMP_UPLOAD', ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
                """, tempUploadId, stored.sha256(), stored.path().toString(), stored.originalFilename(), stored.size(),
                result.uncompressedSize(), result.fileCount(), result.status().name(), result.riskLevel(), precheck,
                tempUploadId, actor.id());
        for (FileManifestItem item : result.files()) {
            jdbc.update("""
                    insert into package_files (id, package_object_id, relative_path, size_bytes, sha256, file_type,
                      risk_flags, previewable)
                    values (?, ?, ?, ?, ?, ?, ?::jsonb, ?)
                    """, UUID.randomUUID(), tempUploadId, item.path(), item.size(), item.sha256(), item.type().name(),
                    json.write(item.riskFlags()), item.previewable());
        }
        for (PreviewCandidate preview : result.previews()) {
            jdbc.update("""
                    insert into package_previews (id, package_object_id, relative_path, content, truncated, original_size, redaction_count)
                    values (?, ?, ?, ?, ?, ?, ?)
                    """, UUID.randomUUID(), tempUploadId, preview.path(), preview.content(), preview.truncated(),
                    preview.originalSize(), preview.redactionCount());
        }
    }

    public Map<String, Object> files(CurrentUser actor, UUID packageId) {
        requireVisible(actor, packageId);
        List<Map<String, Object>> files = jdbc.queryForList("""
                select relative_path as path, size_bytes as size, sha256, file_type as type, risk_flags::text as risk_flags, previewable
                from package_files where package_object_id = ? order by relative_path
                """, packageId).stream().map(row -> {
                    Map<String, Object> item = new LinkedHashMap<>(row);
                    item.put("riskFlags", json.read((String) row.get("risk_flags")));
                    item.remove("risk_flags");
                    return item;
                }).toList();
        return Map.of("packageId", packageId, "items", files);
    }

    public Map<String, Object> preview(CurrentUser actor, UUID packageId, String path) {
        requireVisible(actor, packageId);
        var rows = jdbc.queryForList("""
                select content, truncated, original_size, redaction_count from package_previews
                where package_object_id = ? and relative_path = ?
                """, packageId, path);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "文件不可预览或不存在");
        }
        Map<String, Object> row = rows.get(0);
        return Map.of("packageId", packageId, "path", path, "content", row.get("content"),
                "truncated", row.get("truncated"), "originalSize", row.get("original_size"),
                "redactionCount", row.get("redaction_count"));
    }

    public Map<String, Object> riskSummary(CurrentUser actor, UUID packageId) {
        if (!actor.isAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权查看包风险摘要");
        }
        return packageSummary(packageId);
    }

    public String consumeForSubmission(CurrentUser actor, ExtensionType extensionType, String extensionId, String version,
            List<Map<String, Object>> uploadRefs) {
        if (uploadRefs == null || uploadRefs.isEmpty()) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "发布申请必须引用已通过校验的包或配置清单");
        }
        if (uploadRefs.size() != 1) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "一次提交只能引用一个临时上传");
        }
        Map<String, Object> ref = uploadRefs.get(0);
        UUID tempUploadId = parseUuid(ref.get("tempUploadId"));
        UploadType expected = expectedUploadType(extensionType);
        Map<String, Object> upload = lockUpload(tempUploadId);
        if (!actor.id().equals(upload.get("created_by"))) {
            throw new BusinessException(ErrorCode.UPLOAD_NOT_OWNED, "临时上传不属于当前用户");
        }
        String status = String.valueOf(upload.get("status"));
        if ("CONSUMED".equals(status)) {
            throw new BusinessException(ErrorCode.UPLOAD_ALREADY_CONSUMED, "临时上传已被消费");
        }
        if (!"AVAILABLE".equals(status)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "临时上传不可用");
        }
        if (offsetDateTime(upload.get("expires_at")).isBefore(OffsetDateTime.now())) {
            jdbc.update("update temp_uploads set status = 'EXPIRED' where id = ?", tempUploadId);
            throw new BusinessException(ErrorCode.UPLOAD_EXPIRED, "临时上传已过期");
        }
        if (!expected.name().equals(upload.get("upload_type")) && !(extensionType == ExtensionType.PLUGIN
                && UploadType.PLUGIN_MANIFEST.name().equals(upload.get("upload_type")))) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "上传类型与扩展类型不匹配");
        }
        Object expectedHash = ref.get("sha256");
        if (expectedHash != null && !String.valueOf(expectedHash).equals(upload.get("sha256"))) {
            throw new BusinessException(ErrorCode.HASH_MISMATCH, "上传 Hash 不匹配");
        }
        Path tempPath = Path.of(String.valueOf(upload.get("temp_path")));
        String currentHash;
        try (var input = Files.newInputStream(tempPath)) {
            currentHash = Hashing.sha256(input);
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.STORAGE_WRITE_FAILED, "临时包读取失败");
        }
        if (!currentHash.equals(upload.get("sha256"))) {
            throw new BusinessException(ErrorCode.HASH_MISMATCH, "临时包 Hash 已变化");
        }
        Path finalPath = storageService.moveTempToFinal(tempPath, UploadType.valueOf(String.valueOf(upload.get("upload_type"))),
                extensionId, version, String.valueOf(upload.get("sha256")), String.valueOf(upload.get("original_filename")));
        jdbc.update("update temp_uploads set status = 'CONSUMED', consumed_at = now() where id = ?", tempUploadId);
        String objectType = submissionObjectType(extensionType, upload);
        jdbc.update("""
                update package_objects
                   set object_type = ?,
                       extension_business_id = ?,
                       version = ?,
                       storage_path = ?
                 where id = ? and object_type = 'TEMP_UPLOAD'
                """, objectType, extensionId, version, finalPath.toString(), tempUploadId);
        try {
            Files.deleteIfExists(tempPath);
        } catch (IOException ignored) {
            // Temp DB state is authoritative; cleanup can be retried by maintenance.
        }
        return packageSnapshot(tempUploadId, upload, extensionType, extensionId, version, finalPath.toString(), objectType);
    }

    private String submissionObjectType(ExtensionType extensionType, Map<String, Object> upload) {
        if (extensionType != ExtensionType.PLUGIN) {
            return "EXTENSION_PACKAGE";
        }
        Map<String, Object> precheck = json.readMap(String.valueOf(upload.get("precheck_result")));
        Object definitionValue = precheck.get("definition");
        if (definitionValue instanceof Map<?, ?> definition
                && "MANUAL_DOWNLOAD".equals(String.valueOf(definition.get("installMode")))) {
            return "EXTERNAL_PLUGIN_FILE";
        }
        return "EXTENSION_PACKAGE";
    }

    private Map<String, Object> packageSummary(UUID packageId) {
        var rows = jdbc.queryForList("""
                select id, sha256, size_bytes, file_count, precheck_status, risk_level, risk_summary::text as risk_summary
                from package_objects where id = ?
                """, packageId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "包不存在");
        }
        Map<String, Object> row = new LinkedHashMap<>(rows.get(0));
        row.put("riskSummary", json.read((String) row.get("risk_summary")));
        row.remove("risk_summary");
        return row;
    }

    private String packageSnapshot(UUID packageId, Map<String, Object> upload, ExtensionType extensionType,
            String extensionId, String version, String finalPath, String objectType) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("mode", "PACKAGE_OBJECT");
        data.put("packageStorageStatus", "CONSUMED");
        data.put("objectType", objectType);
        data.put("packageId", packageId);
        data.put("extensionType", extensionType.name());
        data.put("extensionId", extensionId);
        data.put("version", version);
        data.put("sha256", upload.get("sha256"));
        data.put("size", upload.get("size_bytes"));
        data.put("fileCount", upload.get("file_count"));
        data.put("storagePath", finalPath);
        data.put("precheck", json.read(String.valueOf(upload.get("precheck_result"))));
        data.put("filesUrl", "/api/packages/" + packageId + "/files");
        data.put("riskSummaryUrl", "/api/admin/packages/" + packageId + "/risk-summary");
        return json.write(json.envelopeMap("submission", data));
    }

    private Map<String, Object> lockUpload(UUID tempUploadId) {
        var rows = jdbc.queryForList("select *, precheck_result::text as precheck_result from temp_uploads where id = ? for update",
                tempUploadId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "临时上传不存在");
        }
        return rows.get(0);
    }

    private UUID parseUuid(Object value) {
        try {
            return UUID.fromString(String.valueOf(value));
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "临时上传 ID 不合法");
        }
    }

    private OffsetDateTime offsetDateTime(Object value) {
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime;
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant().atOffset(java.time.ZoneOffset.UTC);
        }
        return OffsetDateTime.parse(String.valueOf(value));
    }

    private UploadType expectedUploadType(ExtensionType extensionType) {
        return switch (extensionType) {
            case SKILL -> UploadType.SKILL_PACKAGE;
            case MCP_SERVER -> UploadType.MCP_MANIFEST;
            case PLUGIN -> UploadType.PLUGIN_PACKAGE;
        };
    }

    private void requireVisible(CurrentUser actor, UUID packageId) {
        Boolean exists = jdbc.queryForObject("""
                select exists(select 1 from package_objects where id = ? and created_by = ?)
                """, Boolean.class, packageId, actor.id());
        if (!Boolean.TRUE.equals(exists) && !actor.isAdmin()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "包不存在");
        }
    }

    private Map<String, Object> response(UUID tempUploadId, UploadType uploadType, PackageStorageService.StoredTempFile stored,
            SafeZipExtractResult result) {
        Map<String, Object> precheck = precheckEnvelope(result, uploadType);
        return Map.of(
                "tempUploadId", tempUploadId,
                "packageId", tempUploadId,
                "uploadType", uploadType.name(),
                "sha256", stored.sha256(),
                "size", stored.size(),
                "fileCount", result.fileCount(),
                "expiresAt", OffsetDateTime.now().plus(properties.getTempTtl()).toString(),
                "precheck", precheck);
    }

    private Map<String, Object> precheckEnvelope(SafeZipExtractResult result, UploadType uploadType) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schemaVersion", 1);
        envelope.put("uploadType", uploadType.name());
        envelope.put("status", result.status().name());
        envelope.put("rejected", result.rejected());
        if (result.rejectCode() != null) {
            envelope.put("rejectCode", result.rejectCode());
        }
        if (uploadType == UploadType.SKILL_PACKAGE) {
            envelope.put("requiredStructure", "SKILL.md must be present at the zip root");
        }
        envelope.put("warnings", result.findings());
        envelope.put("fileManifestSummary", Map.of(
                "previewableCount", result.files().stream().filter(FileManifestItem::previewable).count(),
                "riskFileCount", result.files().stream().filter(item -> !item.riskFlags().isEmpty()).count()));
        envelope.put("riskSummary", Map.of("riskLevel", result.riskLevel(),
                "riskFlags", result.findings().stream().map(RiskFinding::code).distinct().toList()));
        Map<String, Object> definition = definitionSnapshot(uploadType, result);
        if (!definition.isEmpty()) {
            envelope.put("definition", definition);
        }
        return envelope;
    }

    private Map<String, Object> definitionSnapshot(UploadType uploadType, SafeZipExtractResult result) {
        if (uploadType == UploadType.SKILL_PACKAGE) {
            PreviewCandidate manifest = rootPreview(result, "SKILL.md");
            return manifest == null ? Map.of() : skillDefinitionSnapshot(manifest.content());
        }
        if (uploadType == UploadType.MCP_MANIFEST) {
            PreviewCandidate manifest = firstPreview(result, "mcp.json", "mcp.yaml", "mcp.yml", "manifest.json");
            return manifest == null ? Map.of() : mcpDefinitionSnapshot(parseLooseManifest(manifest.content()));
        }
        if (uploadType == UploadType.PLUGIN_PACKAGE || uploadType == UploadType.PLUGIN_MANIFEST) {
            PreviewCandidate manifest = firstPreview(result, "plugin.json", "plugin.yaml", "plugin.yml", "manifest.json");
            return manifest == null ? Map.of() : pluginDefinitionSnapshot(parseLooseManifest(manifest.content()));
        }
        return Map.of();
    }

    private Map<String, Object> skillDefinitionSnapshot(String content) {
        Map<String, Object> manifest = parseSkillFrontmatter(content);
        Map<String, Object> definition = new LinkedHashMap<>();
        putIfPresent(definition, "extensionId", firstString(manifest, "extensionid", "extension_id", "id"));
        putIfPresent(definition, "name", manifest.get("name"));
        putIfPresent(definition, "description", firstString(manifest, "description", "summary"));
        putIfPresent(definition, "version", manifest.get("version"));
        return definition;
    }

    private Map<String, Object> mcpDefinitionSnapshot(Map<String, Object> manifest) {
        Map<String, Object> definition = new LinkedHashMap<>();
        String accessType = stringValue(manifest.get("accessType"));
        String transport = normalizeMcpTransport(stringValue(manifest.get("transport")));
        definition.put("accessType", accessType);
        definition.put("transport", transport);
        String endpoint = stringValue(manifest.get("endpoint"));
        if (!endpoint.isBlank()) {
            definition.put("endpointTemplate", endpoint);
        }
        String command = stringValue(manifest.get("command"));
        if (!command.isBlank()) {
            definition.put("command", command);
        }
        putIfPresent(definition, "args", manifest.get("args"));
        putIfPresent(definition, "workingDirectory", manifest.get("workingDirectory"));
        putIfPresent(definition, "envSummary", manifest.get("envSummary"));
        putIfPresent(definition, "variablesSchema", manifest.get("variablesSchema"));
        putIfPresent(definition, "configTemplate", manifest.get("configTemplate"));
        putIfPresent(definition, "connectionTest", manifest.get("connectionTest"));
        putIfPresent(definition, "permissions", manifest.get("permissions"));
        putIfPresent(definition, "dataAccess", manifest.get("dataAccess"));
        putIfPresent(definition, "riskStatement", manifest.get("riskStatement"));
        return definition;
    }

    private Map<String, Object> pluginDefinitionSnapshot(Map<String, Object> manifest) {
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("installMode", normalizePluginInstallMode(stringValue(manifest.get("installMode"))));
        putIfPresent(definition, "targetTools",
                manifest.containsKey("targetTools") ? manifest.get("targetTools") : manifest.get("targetTool"));
        putIfPresent(definition, "manualInstallDoc", manifest.get("manualInstallDoc"));
        putIfPresent(definition, "manualUninstallDoc", manifest.get("manualUninstallDoc"));
        putIfPresent(definition, "externalDownload", manifest.get("externalDownload"));
        definition.put("manifest", manifest);
        return definition;
    }

    private void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value != null && !(value instanceof String string && string.isBlank())) {
            target.put(key, value);
        }
    }

    private String normalizeMcpTransport(String transport) {
        return "http".equals(transport) ? "streamable-http" : transport;
    }

    private String normalizePluginInstallMode(String installMode) {
        if (installMode == null || installMode.isBlank()) {
            return "CONFIG_PLUGIN";
        }
        return installMode.trim().toUpperCase().replace('-', '_');
    }

    private SafeZipExtractResult validateMcpManifest(PackageStorageService.StoredTempFile stored, SafeZipExtractResult result) {
        PreviewCandidate manifest = firstPreview(result, "mcp.json", "mcp.yaml", "mcp.yml", "manifest.json");
        if (manifest == null) {
            return rejectedResult(stored, result, "validation_failed");
        }
        Map<String, Object> manifestMap = parseLooseManifest(manifest.content());
        String accessType = stringValue(manifestMap.get("accessType"));
        String transport = stringValue(manifestMap.get("transport"));
        if ("http".equals(transport)) {
            transport = "streamable-http";
        }
        boolean valid = ("remote-http".equals(accessType) && "streamable-http".equals(transport))
                || ("remote-sse".equals(accessType) && "sse".equals(transport))
                || ("local-command".equals(accessType) && "stdio".equals(transport));
        if (!valid) {
            return rejectedResult(stored, result, "mcp_transport_invalid");
        }
        if (accessType.startsWith("remote") && !stringValue(manifestMap.get("endpoint")).matches("^https?://.+")) {
            return rejectedResult(stored, result, "mcp_endpoint_invalid");
        }
        if ("local-command".equals(accessType) && stringValue(manifestMap.get("command")).isBlank()) {
            return rejectedResult(stored, result, "mcp_transport_invalid");
        }
        return result;
    }

    private SafeZipExtractResult validatePluginManifest(PackageStorageService.StoredTempFile stored, SafeZipExtractResult result) {
        PreviewCandidate manifest = firstPreview(result, "plugin.json", "plugin.yaml", "plugin.yml", "manifest.json");
        if (manifest == null) {
            return rejectedResult(stored, result, "plugin_manifest_invalid");
        }
        Map<String, Object> manifestMap = parseLooseManifest(manifest.content());
        if (stringValue(manifestMap.get("pluginName")).isBlank() || stringValue(manifestMap.get("version")).isBlank()
                || stringValue(manifestMap.get("installMode")).isBlank()) {
            return rejectedResult(stored, result, "plugin_manifest_invalid");
        }
        String installMode = stringValue(manifestMap.get("installMode"));
        String normalizedInstallMode = normalizePluginInstallMode(installMode);
        if (!List.of("MANAGED_PACKAGE", "CONFIG_PLUGIN", "MANUAL_DOWNLOAD").contains(normalizedInstallMode)) {
            return rejectedResult(stored, result, "plugin_manifest_invalid");
        }
        if ("MANUAL_DOWNLOAD".equals(normalizedInstallMode) && stringValue(manifestMap.get("expiresAt")).contains("2000-")) {
            return rejectedResult(stored, result, "plugin_download_source_expired");
        }
        return result;
    }

    private PreviewCandidate firstPreview(SafeZipExtractResult result, String... names) {
        for (String name : names) {
            for (PreviewCandidate preview : result.previews()) {
                if (name.equalsIgnoreCase(preview.path())
                        || preview.path().toLowerCase(Locale.ROOT).endsWith("/" + name.toLowerCase(Locale.ROOT))) {
                    return preview;
                }
            }
        }
        return null;
    }

    private PreviewCandidate rootPreview(SafeZipExtractResult result, String name) {
        for (PreviewCandidate preview : result.previews()) {
            if (name.equalsIgnoreCase(preview.path())) {
                return preview;
            }
        }
        return null;
    }

    private Map<String, Object> parseLooseManifest(String content) {
        Object parsed = json.read(content);
        if (parsed instanceof Map<?, ?> map) {
            Map<String, Object> output = new LinkedHashMap<>();
            map.forEach((key, value) -> output.put(String.valueOf(key), value));
            return output;
        }
        Map<String, Object> output = new LinkedHashMap<>();
        for (String line : content.split("\\R")) {
            int separator = line.indexOf(':');
            if (separator > 0) {
                output.put(line.substring(0, separator).trim(), line.substring(separator + 1).trim().replace("\"", ""));
            }
        }
        return output;
    }

    private Map<String, Object> parseSkillFrontmatter(String content) {
        String normalized = content.replace("\r\n", "\n");
        if (!normalized.startsWith("---\n")) {
            return Map.of();
        }
        int end = normalized.indexOf("\n---", 4);
        if (end < 0) {
            return Map.of();
        }
        Map<String, Object> output = new LinkedHashMap<>();
        for (String line : normalized.substring(4, end).split("\\R")) {
            int separator = line.indexOf(':');
            if (separator > 0) {
                output.put(normalizeManifestKey(line.substring(0, separator)),
                        unquote(line.substring(separator + 1).trim()));
            }
        }
        return output;
    }

    private String normalizeManifestKey(String key) {
        return key.trim().toLowerCase(Locale.ROOT).replace("-", "_");
    }

    private String firstString(Map<String, Object> values, String... keys) {
        for (String key : keys) {
            String value = stringValue(values.get(key));
            if (!value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String unquote(String value) {
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private SafeZipExtractResult rejectedResult(PackageStorageService.StoredTempFile stored, SafeZipExtractResult result,
            String rejectCode) {
        return new SafeZipExtractResult(stored.sha256(), stored.size(), result.uncompressedSize(), result.fileCount(),
                result.files(), result.findings(), result.previews(), true, rejectCode);
    }

    private ErrorCode errorCode(String code) {
        return switch (code) {
            case "package_too_large" -> ErrorCode.PACKAGE_TOO_LARGE;
            case "package_file_count_exceeded" -> ErrorCode.PACKAGE_FILE_COUNT_EXCEEDED;
            case "package_path_traversal" -> ErrorCode.PACKAGE_PATH_TRAVERSAL;
            case "package_uncompressed_size_exceeded" -> ErrorCode.PACKAGE_UNCOMPRESSED_SIZE_EXCEEDED;
            case "skill_manifest_missing" -> ErrorCode.SKILL_MANIFEST_MISSING;
            case "mcp_transport_invalid" -> ErrorCode.MCP_TRANSPORT_INVALID;
            case "mcp_endpoint_invalid" -> ErrorCode.MCP_ENDPOINT_INVALID;
            case "plugin_manifest_invalid" -> ErrorCode.PLUGIN_MANIFEST_INVALID;
            case "plugin_download_source_expired" -> ErrorCode.PLUGIN_DOWNLOAD_SOURCE_EXPIRED;
            default -> ErrorCode.VALIDATION_FAILED;
        };
    }

    private String rejectMessage(String code) {
        return switch (code) {
            case "package_path_traversal" -> "包内路径不安全";
            case "package_too_large" -> "包大小超过限制";
            case "package_file_count_exceeded" -> "包内文件数量超过限制";
            case "package_uncompressed_size_exceeded" -> "包解压后体积超过限制";
            case "skill_manifest_missing" -> "Skill 包缺少 SKILL.md";
            case "mcp_transport_invalid" -> "MCP transport 与 accessType 组合不合法";
            case "mcp_endpoint_invalid" -> "MCP endpoint 不合法";
            case "plugin_manifest_invalid" -> "Plugin 安装清单不完整";
            case "plugin_download_source_expired" -> "Plugin 企业内部下载地址已过期";
            default -> "包校验失败";
        };
    }
}
