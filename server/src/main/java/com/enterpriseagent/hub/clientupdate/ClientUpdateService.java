package com.enterpriseagent.hub.clientupdate;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.common.audit.AuditRecord;
import com.enterpriseagent.hub.common.audit.AuditResult;
import com.enterpriseagent.hub.common.audit.AuditService;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.common.pagination.PageResult;
import com.enterpriseagent.hub.common.request.RequestContext;
import com.enterpriseagent.hub.extension.ExtensionJson;
import com.enterpriseagent.hub.packages.DownloadTicketService;
import com.enterpriseagent.hub.packages.PackageStorageService;
import com.enterpriseagent.hub.packages.UploadType;

@Service
public class ClientUpdateService {
    private static final Pattern CLIENT_VERSION_PATTERN = Pattern.compile("\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?");
    private static final Pattern SHA256_PATTERN = Pattern.compile("[0-9a-fA-F]{64}");
    private static final int MAX_PAGE_SIZE = 100;

    private final JdbcTemplate jdbc;
    private final ExtensionJson json;
    private final PackageStorageService storageService;
    private final DownloadTicketService downloadTicketService;
    private final AuditService auditService;

    public ClientUpdateService(JdbcTemplate jdbc, ExtensionJson json, PackageStorageService storageService,
            DownloadTicketService downloadTicketService, AuditService auditService) {
        this.jdbc = jdbc;
        this.json = json;
        this.storageService = storageService;
        this.downloadTicketService = downloadTicketService;
        this.auditService = auditService;
    }

    @Transactional
    public Map<String, Object> create(CurrentUser actor, Map<String, Object> request) {
        requireSystemAdmin(actor);
        UUID id = UUID.randomUUID();
        String version = validateClientVersion(required(request, "version"), "version");
        String minSupportedVersion = string(request.get("minSupportedVersion"));
        if (StringUtils.hasText(minSupportedVersion)) {
            minSupportedVersion = validateClientVersion(minSupportedVersion, "minSupportedVersion");
        }
        String platform = normalizePlatform(defaultString(request.get("platform"), "WINDOWS"));
        String arch = normalizeArch(defaultString(request.get("arch"), "X64"));
        String channel = normalizeChannel(defaultString(request.get("channel"), "STABLE"));
        PackageMetadata packageMetadata = consumePackage(actor, request, version);
        jdbc.update("""
                insert into client_versions (id, version, build_no, platform, arch, channel, force_update,
                  min_supported_version, release_notes, package_object_id, package_sha256, package_size,
                  signature_status, certificate_summary, status, created_by)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, 'DRAFT', ?)
                """, id, version, defaultString(request.get("buildNo"), "0"), platform, arch, channel,
                Boolean.TRUE.equals(request.get("forceUpdate")), minSupportedVersion, string(request.get("releaseNotes")),
                packageMetadata.packageObjectId(), packageMetadata.sha256(), packageMetadata.sizeBytes(),
                defaultString(request.get("signatureStatus"), "UNKNOWN"), json.write(payload(request.get("certificateSummary"))), actor.id());
        audit(actor, id, "client_update.create", "DRAFT", string(request.get("reason")), AuditResult.SUCCESS);
        return getVersion(id);
    }

    @Transactional
    public Map<String, Object> transition(CurrentUser actor, UUID id, Map<String, Object> request, String targetStatus) {
        requireSystemAdmin(actor);
        Map<String, Object> current = lockVersion(id);
        String expected = string(request.get("expectedStatus"));
        if (StringUtils.hasText(expected) && !expected.equals(current.get("status"))) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "客户端更新状态已变化",
                    Map.of("expectedStatus", expected, "currentStatus", current.get("status")));
        }
        if ("PUBLISHED".equals(targetStatus)) {
            if (!"DRAFT".equals(current.get("status")) && !"PAUSED".equals(current.get("status"))) {
                throw new BusinessException(ErrorCode.STATE_CONFLICT, "只有草稿或暂停版本可发布");
            }
            if (!"VALID".equals(current.get("signature_status"))) {
                audit(actor, id, "client_update.publish", "SIGNATURE_INVALID", string(request.get("reason")), AuditResult.FAILURE);
                throw new BusinessException(ErrorCode.SIGNATURE_INVALID, "签名状态无效，不能发布");
            }
            if (current.get("package_object_id") == null) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少客户端更新包");
            }
            validateClientVersion(String.valueOf(current.get("version")), "version");
            verifyPublishablePackage(current);
            jdbc.update("update client_versions set status = 'PUBLISHED', published_at = now(), updated_at = now() where id = ?", id);
        } else if ("PAUSED".equals(targetStatus)) {
            if (!"PUBLISHED".equals(current.get("status"))) {
                throw new BusinessException(ErrorCode.STATE_CONFLICT, "只有已发布版本可暂停");
            }
            jdbc.update("update client_versions set status = 'PAUSED', updated_at = now() where id = ?", id);
        } else if ("WITHDRAWN".equals(targetStatus)) {
            jdbc.update("update client_versions set status = 'WITHDRAWN', updated_at = now() where id = ?", id);
        }
        audit(actor, id, "client_update." + targetStatus.toLowerCase(java.util.Locale.ROOT), targetStatus,
                string(request.get("reason")), AuditResult.SUCCESS);
        return getVersion(id);
    }

    @Transactional
    public Map<String, Object> check(CurrentUser actor, String deviceId, String currentVersion, String platform, String arch, String channel) {
        requireOwnedActiveDevice(actor, deviceId);
        String normalizedPlatform = normalizePlatform(defaultString(platform, "WINDOWS"));
        String normalizedArch = normalizeArch(arch);
        String normalizedChannel = normalizeChannel(channel);
        var rows = jdbc.queryForList("""
                select * from client_versions
                 where status = 'PUBLISHED' and signature_status = 'VALID'
                   and platform = ? and arch = ? and channel = ?
                 order by published_at desc nulls last, created_at desc
                """, normalizedPlatform, normalizedArch, normalizedChannel).stream()
                .filter(row -> isNewer(String.valueOf(row.get("version")), currentVersion))
                .sorted((left, right) -> compareClientVersions(String.valueOf(right.get("version")),
                        String.valueOf(left.get("version"))))
                .toList();
        if (rows.isEmpty()) {
            recordEvent(null, actor, deviceId, "UPDATE_CHECK", "SUCCESS", null, currentVersion, null,
                    Map.of("updateAvailable", false));
            return Map.of("updateAvailable", false);
        }
        Map<String, Object> row = rows.get(0);
        UUID versionId = (UUID) row.get("id");
        recordEvent(versionId, actor, deviceId, "UPDATE_CHECK", "SUCCESS", null, currentVersion,
                String.valueOf(row.get("version")), Map.of("updateAvailable", true));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("updateAvailable", true);
        response.put("versionId", versionId);
        response.put("version", row.get("version"));
        response.put("buildNo", row.get("build_no"));
        response.put("forceUpdate", row.get("force_update"));
        response.put("minSupportedVersion", row.get("min_supported_version"));
        response.put("releaseNotes", row.get("release_notes"));
        response.put("packageSize", row.get("package_size"));
        response.put("sha256", row.get("package_sha256"));
        response.put("signatureStatus", row.get("signature_status"));
        response.put("downloadTicketRequired", true);
        return response;
    }

    @Transactional
    public Map<String, Object> downloadTicket(CurrentUser actor, UUID versionId, Map<String, Object> request) {
        String deviceId = required(request, "deviceId");
        String currentVersion = string(request.get("currentVersion"));
        Map<String, Object> response = downloadTicketService.issueClientUpdate(actor, versionId, deviceId, currentVersion);
        recordEvent(versionId, actor, deviceId, "DOWNLOAD_TICKET_ISSUED", "SUCCESS", null, currentVersion,
                string(response.get("version")), Map.of("ticketId", String.valueOf(response.get("ticketId"))));
        return response;
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String, Object> recordClientEvent(CurrentUser actor, Map<String, Object> request) {
        if (request.get("events") instanceof List<?> events) {
            String parentDeviceId = defaultString(request.get("deviceId"), actor.deviceId());
            List<Map<String, Object>> results = new ArrayList<>();
            for (Object raw : events) {
                if (!(raw instanceof Map<?, ?> event)) {
                    results.add(Map.of("status", "REJECTED", "errorCode", "invalid_event"));
                    continue;
                }
                Map<String, Object> merged = new LinkedHashMap<>((Map<String, Object>) event);
                merged.putIfAbsent("deviceId", parentDeviceId);
                recordSingleClientEvent(actor, merged);
                results.add(Map.of("idempotencyKey", defaultString(merged.get("idempotencyKey"), ""),
                        "status", "ACCEPTED"));
            }
            return Map.of("results", results);
        }
        return recordSingleClientEvent(actor, request);
    }

    private Map<String, Object> recordSingleClientEvent(CurrentUser actor, Map<String, Object> request) {
        UUID versionId = uuid(request.get("versionId"));
        String deviceId = defaultString(request.get("deviceId"), actor.deviceId());
        if (StringUtils.hasText(deviceId)) {
            requireOwnedActiveDevice(actor, deviceId);
        }
        String type = required(request, "eventType");
        String result = defaultString(request.get("result"), "SUCCESS");
        String errorCode = string(request.get("errorCode"));
        recordEvent(versionId, actor, deviceId, type, result, errorCode, string(request.get("fromVersion")),
                string(request.get("toVersion")), payload(request.get("payloadSummary")));
        if (StringUtils.hasText(errorCode) || type.contains("FAILED") || type.contains("SIGNATURE") || type.contains("HASH")) {
            auditService.recordFailure(AuditRecord.builder()
                    .actorId(actor.id())
                    .objectType("client_update")
                    .objectId(versionId == null ? null : versionId.toString())
                    .action("client_update.event." + type.toLowerCase(java.util.Locale.ROOT))
                    .result(AuditResult.FAILURE)
                    .reason(errorCode)
                    .deviceId(deviceId)
                    .clientVersion(actor.clientVersion())
                    .afterSummary(payload(request.get("payloadSummary")))
                    .build());
        }
        return Map.of("accepted", true);
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> list(CurrentUser actor, String status, String version, int page, int pageSize) {
        requireSystemAdmin(actor);
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" where 1 = 1");
        if (StringUtils.hasText(status)) {
            where.append(" and status = ?");
            params.add(status.toUpperCase(Locale.ROOT));
        }
        if (StringUtils.hasText(version)) {
            where.append(" and version like ?");
            params.add("%" + version + "%");
        }
        long total = count("select count(*) from client_versions" + where, params);
        int safePage = safePage(page);
        int safePageSize = safePageSize(pageSize);
        List<Object> queryParams = new ArrayList<>(params);
        queryParams.add(safePageSize);
        queryParams.add(offset(safePage, safePageSize));
        List<Map<String, Object>> rows = jdbc.queryForList("select * from client_versions" + where
                        + " order by created_at desc limit ? offset ?", queryParams.toArray()).stream()
                .map(this::versionRow)
                .toList();
        return page(rows, safePage, safePageSize, total);
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> events(CurrentUser actor, UUID versionId, String deviceId, String result,
            String errorCode, int page, int pageSize) {
        if (!actor.isAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权查看客户端更新事件");
        }
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" where 1 = 1");
        if (versionId != null) {
            where.append(" and version_id = ?");
            params.add(versionId);
        }
        if (StringUtils.hasText(deviceId)) {
            where.append(" and device_id = ?");
            params.add(deviceId);
        }
        if (StringUtils.hasText(result)) {
            where.append(" and result = ?");
            params.add(result);
        }
        if (StringUtils.hasText(errorCode)) {
            where.append(" and error_code = ?");
            params.add(errorCode);
        }
        long total = count("select count(*) from client_update_events" + where, params);
        int safePage = safePage(page);
        int safePageSize = safePageSize(pageSize);
        List<Object> queryParams = new ArrayList<>(params);
        queryParams.add(safePageSize);
        queryParams.add(offset(safePage, safePageSize));
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select version_id, device_id, user_id, event_type, result, error_code, request_id, from_version, to_version,
                       payload_summary::text as payload_summary, occurred_at, created_at
                  from client_update_events
                """ + where + " order by created_at desc limit ? offset ?", queryParams.toArray()).stream()
                .map(this::eventRow)
                .toList();
        return page(rows, safePage, safePageSize, total);
    }

    private PackageMetadata consumePackage(CurrentUser actor, Map<String, Object> request, String version) {
        UUID tempUploadId = uuid(request.get("packageTempUploadId"));
        if (tempUploadId == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 packageTempUploadId");
        }
        Map<String, Object> upload = jdbc.queryForList("select * from temp_uploads where id = ? for update", tempUploadId)
                .stream().findFirst().orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "更新包不存在"));
        if (!actor.id().equals(upload.get("created_by"))) {
            throw new BusinessException(ErrorCode.UPLOAD_NOT_OWNED, "更新包不属于当前用户");
        }
        if (!"CLIENT_UPDATE_PACKAGE".equals(upload.get("upload_type"))) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "上传类型不是客户端更新包");
        }
        if (!"AVAILABLE".equals(upload.get("status"))) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "更新包不可用");
        }
        String expectedHash = validateSha256(required(request, "packageSha256"));
        String actualHash = validateSha256(String.valueOf(upload.get("sha256")));
        if (!expectedHash.equalsIgnoreCase(actualHash)) {
            throw new BusinessException(ErrorCode.HASH_MISMATCH, "更新包 Hash 不匹配");
        }
        long expectedSize = requiredLong(request, "packageSize");
        long actualSize = ((Number) upload.get("size_bytes")).longValue();
        if (expectedSize != actualSize) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "更新包大小不匹配");
        }
        Path tempPath = Path.of(String.valueOf(upload.get("temp_path")));
        try (var input = Files.newInputStream(tempPath)) {
            if (!actualHash.equalsIgnoreCase(sha256(input))) {
                throw new BusinessException(ErrorCode.HASH_MISMATCH, "更新包 Hash 已变化");
            }
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.STORAGE_WRITE_FAILED, "更新包读取失败");
        }
        Path finalPath = storageService.moveTempToFinal(tempPath, UploadType.CLIENT_UPDATE_PACKAGE, "client-update", version,
                String.valueOf(upload.get("sha256")), String.valueOf(upload.get("original_filename")));
        jdbc.update("update temp_uploads set status = 'CONSUMED', consumed_at = now() where id = ?", tempUploadId);
        jdbc.update("""
                update package_objects set object_type = 'CLIENT_UPDATE_PACKAGE', version = ?, storage_path = ?
                 where id = ? and object_type = 'TEMP_UPLOAD'
                """, version, finalPath.toString(), tempUploadId);
        return new PackageMetadata(tempUploadId, actualHash.toLowerCase(Locale.ROOT), actualSize);
    }

    private void recordEvent(UUID versionId, CurrentUser actor, String deviceId, String type, String result,
            String errorCode, String fromVersion, String toVersion, Map<String, Object> payload) {
        jdbc.update("""
                insert into client_update_events (id, version_id, device_id, user_id, event_type, result, error_code,
                  request_id, from_version, to_version, payload_summary, occurred_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)
                """, UUID.randomUUID(), versionId, deviceId, actor.id(), type, result, errorCode,
                RequestContext.requireRequestId(), fromVersion, toVersion, json.write(payload), OffsetDateTime.now());
    }

    private Map<String, Object> lockVersion(UUID id) {
        return jdbc.queryForList("select * from client_versions where id = ? for update", id).stream().findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "客户端更新版本不存在"));
    }

    private Map<String, Object> getVersion(UUID id) {
        return versionRow(jdbc.queryForList("select * from client_versions where id = ?", id).stream().findFirst().orElseThrow());
    }

    private Map<String, Object> versionRow(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>(row);
        if (output.containsKey("certificate_summary")) {
            output.put("certificateSummary", json.read(String.valueOf(output.remove("certificate_summary"))));
        }
        return output;
    }

    private Map<String, Object> eventRow(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>(row);
        output.put("payloadSummary", json.read((String) output.remove("payload_summary")));
        return output;
    }

    private void audit(CurrentUser actor, UUID id, String action, String status, String reason, AuditResult result) {
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .objectType("client_update")
                .objectId(id.toString())
                .action(action)
                .result(result)
                .reason(reason)
                .afterSummary(Map.of("status", status))
                .build());
    }

    private boolean isNewer(String candidate, String current) {
        return compareClientVersions(candidate, current) > 0;
    }

    private int compareClientVersions(String candidate, String current) {
        ClientVersion candidateVersion = parseClientVersion(candidate);
        if (candidateVersion == null) {
            return -1;
        }
        ClientVersion currentClientVersion = parseClientVersion(current);
        if (currentClientVersion == null) {
            return 1;
        }
        return candidateVersion.compareTo(currentClientVersion);
    }

    private void verifyPublishablePackage(Map<String, Object> current) {
        UUID packageObjectId = (UUID) current.get("package_object_id");
        Map<String, Object> packageObject = jdbc.queryForList("""
                select sha256, size_bytes from package_objects
                 where id = ? and object_type = 'CLIENT_UPDATE_PACKAGE'
                """, packageObjectId).stream().findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.VALIDATION_FAILED, "客户端更新包不存在"));
        String expectedHash = validateSha256(String.valueOf(current.get("package_sha256")));
        String actualHash = validateSha256(String.valueOf(packageObject.get("sha256")));
        if (!expectedHash.equalsIgnoreCase(actualHash)) {
            throw new BusinessException(ErrorCode.HASH_MISMATCH, "客户端更新包 Hash 不匹配");
        }
        long expectedSize = ((Number) current.get("package_size")).longValue();
        long actualSize = ((Number) packageObject.get("size_bytes")).longValue();
        if (expectedSize != actualSize) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "客户端更新包大小不匹配");
        }
    }

    private String validateClientVersion(String value, String field) {
        String version = value == null ? null : value.trim();
        if (!StringUtils.hasText(version) || !CLIENT_VERSION_PATTERN.matcher(version).matches()) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, field + " 不是有效语义版本");
        }
        return version;
    }

    private String validateSha256(String value) {
        String sha256 = value == null ? null : value.trim();
        if (!StringUtils.hasText(sha256) || !SHA256_PATTERN.matcher(sha256).matches()) {
            throw new BusinessException(ErrorCode.HASH_MISMATCH, "更新包 Hash 无效");
        }
        return sha256;
    }

    private String normalizePlatform(String value) {
        String normalized = defaultString(value, "WINDOWS").trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "WIN32", "WINDOWS" -> "WINDOWS";
            case "DARWIN", "MAC", "MACOS" -> "MACOS";
            case "LINUX" -> "LINUX";
            default -> normalized;
        };
    }

    private String normalizeArch(String value) {
        String normalized = defaultString(value, "X64").trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "AMD64", "X86_64" -> "X64";
            case "AARCH64" -> "ARM64";
            default -> normalized;
        };
    }

    private String normalizeChannel(String value) {
        String normalized = defaultString(value, "STABLE").trim().toUpperCase(Locale.ROOT);
        if (normalized.length() > 32) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "channel 无效");
        }
        return normalized;
    }

    private ClientVersion parseClientVersion(String value) {
        if (!StringUtils.hasText(value) || "unknown".equalsIgnoreCase(value)) {
            return null;
        }
        String version = value.trim();
        if (!CLIENT_VERSION_PATTERN.matcher(version).matches()) {
            return null;
        }
        String[] mainAndQualifier = version.split("[-+]", 2);
        String[] parts = mainAndQualifier[0].split("\\.");
        return new ClientVersion(Long.parseLong(parts[0]), Long.parseLong(parts[1]), Long.parseLong(parts[2]),
                mainAndQualifier.length > 1 ? mainAndQualifier[1] : "");
    }

    private long count(String sql, List<Object> params) {
        Long count = jdbc.queryForObject(sql, Long.class, params.toArray());
        return count == null ? 0L : count;
    }

    private int safePage(int page) {
        return Math.max(page, 1);
    }

    private int safePageSize(int pageSize) {
        return Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
    }

    private int offset(int page, int pageSize) {
        return (page - 1) * pageSize;
    }

    private PageResult<Map<String, Object>> page(List<Map<String, Object>> rows, int page, int pageSize, long total) {
        return new PageResult<>(rows, page, pageSize, total, offset(page, pageSize) + rows.size() < total);
    }

    private void requireSystemAdmin(CurrentUser actor) {
        if (!actor.isSystemAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "仅系统管理员可管理客户端更新");
        }
    }

    private void requireOwnedActiveDevice(CurrentUser actor, String deviceId) {
        if (!StringUtils.hasText(deviceId)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 deviceId");
        }
        Long count = jdbc.queryForObject("""
                select count(*) from client_devices
                 where device_id = ? and user_id = ? and status = 'ACTIVE'
                """, Long.class, deviceId, actor.id());
        if (count == null || count == 0) {
            throw new BusinessException(ErrorCode.DEVICE_NOT_FOUND, "设备不存在或不属于当前用户");
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> payload(Object value) {
        return value instanceof Map<?, ?> map ? new LinkedHashMap<>((Map<String, Object>) map) : Map.of();
    }

    private UUID uuid(Object value) {
        if (value == null || !StringUtils.hasText(String.valueOf(value))) {
            return null;
        }
        try {
            return UUID.fromString(String.valueOf(value));
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "UUID 格式无效");
        }
    }

    private long requiredLong(Map<String, Object> request, String field) {
        Object value = request.get(field);
        if (value instanceof Number number) return number.longValue();
        if (value == null || !StringUtils.hasText(String.valueOf(value))) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 " + field);
        }
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, field + " 必须是数字");
        }
    }

    private String required(Map<String, Object> request, String field) {
        String value = string(request.get(field));
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 " + field);
        }
        return value;
    }

    private String defaultString(Object value, String fallback) {
        String string = string(value);
        return StringUtils.hasText(string) ? string : fallback;
    }

    private String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private String sha256(InputStream input) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "SHA-256 不可用");
        }
    }

    private record PackageMetadata(UUID packageObjectId, String sha256, long sizeBytes) {
    }

    private record ClientVersion(long major, long minor, long patch, String qualifier)
            implements Comparable<ClientVersion> {
        @Override
        public int compareTo(ClientVersion other) {
            int majorComparison = Long.compare(major, other.major);
            if (majorComparison != 0) return majorComparison;
            int minorComparison = Long.compare(minor, other.minor);
            if (minorComparison != 0) return minorComparison;
            int patchComparison = Long.compare(patch, other.patch);
            if (patchComparison != 0) return patchComparison;
            if (qualifier.isEmpty() && !other.qualifier.isEmpty()) return 1;
            if (!qualifier.isEmpty() && other.qualifier.isEmpty()) return -1;
            return qualifier.compareTo(other.qualifier);
        }
    }
}
