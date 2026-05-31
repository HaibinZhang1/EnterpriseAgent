package com.enterpriseagent.hub.packages;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.core.io.PathResource;
import org.springframework.core.io.Resource;
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
import com.enterpriseagent.hub.common.request.RequestContext;
import com.enterpriseagent.hub.extension.ExtensionJson;
import com.enterpriseagent.hub.extension.VisibilityPolicy;

@Service
public class DownloadTicketService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final PackageStorageProperties properties;
    private final VisibilityPolicy visibilityPolicy;
    private final ExtensionJson json;
    private final AuditService auditService;

    public DownloadTicketService(JdbcTemplate jdbc, PackageStorageProperties properties, VisibilityPolicy visibilityPolicy,
            ExtensionJson json, AuditService auditService) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.visibilityPolicy = visibilityPolicy;
        this.json = json;
        this.auditService = auditService;
    }

    @Transactional
    public Map<String, Object> issue(CurrentUser actor, DownloadTicketRequest request, String idempotencyKey) {
        validateM5Boundary(request);
        Map<String, Object> packageObject = resolvePackage(actor, request);
        if (StringUtils.hasText(idempotencyKey)) {
            return issueWithCredentialReplay(actor, request, packageObject, idempotencyKey);
        }
        return issueFresh(actor, request, packageObject, null);
    }

    @Transactional
    public Map<String, Object> issueClientUpdate(CurrentUser actor, UUID versionId, String deviceId, String currentVersion) {
        if (versionId == null || !StringUtils.hasText(deviceId)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "客户端更新下载缺少版本或设备");
        }
        requireRegisteredDevice(actor, deviceId);
        Map<String, Object> version = jdbc.queryForList("""
                select cv.id as version_id, cv.version, cv.status, cv.signature_status, cv.package_object_id,
                       cv.package_sha256, cv.package_size, po.sha256, po.size_bytes, po.original_filename
                  from client_versions cv
                  join package_objects po on po.id = cv.package_object_id
                 where cv.id = ? for update of cv
                """, versionId).stream().findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "客户端更新版本不存在"));
        if (!"PUBLISHED".equals(String.valueOf(version.get("status")))) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "客户端更新版本未发布");
        }
        if (!"VALID".equals(String.valueOf(version.get("signature_status")))) {
            throw new BusinessException(ErrorCode.SIGNATURE_INVALID, "客户端更新包签名无效");
        }
        Map<String, Object> packageObject = new LinkedHashMap<>();
        packageObject.put("id", version.get("package_object_id"));
        packageObject.put("extension_pk", null);
        packageObject.put("extension_business_id", "client-update");
        packageObject.put("version", version.get("version"));
        packageObject.put("sha256", version.get("package_sha256") != null && StringUtils.hasText(String.valueOf(version.get("package_sha256")))
                ? version.get("package_sha256") : version.get("sha256"));
        packageObject.put("size_bytes", version.get("package_size") == null
                ? version.get("size_bytes") : version.get("package_size"));
        DownloadTicketRequest request = new DownloadTicketRequest(DownloadObjectType.CLIENT_UPDATE,
                (UUID) version.get("package_object_id"), null, String.valueOf(version.get("version")),
                DownloadPurpose.CLIENT_UPDATE, deviceId);
        Map<String, Object> response = issueFresh(actor, request, packageObject, null);
        response.put("versionId", versionId);
        response.put("version", version.get("version"));
        response.put("currentVersion", currentVersion);
        return response;
    }

    @Transactional
    public DownloadFile authorizeDownload(CurrentUser actor, String ticket) {
        String hash = hash(ticket);
        var rows = jdbc.queryForList("""
                select dt.*, po.storage_path, po.original_filename, po.sha256, po.size_bytes,
                       e.status as extension_status, e.visibility_mode, e.author_id, e.maintainer_id, e.id as ext_pk
                  from download_tickets dt
                  join package_objects po on po.id = dt.object_id
                  left join extensions e on e.id = dt.extension_id
                 where dt.ticket_hash = ? for update of dt
                """, hash);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.DOWNLOAD_TICKET_EXPIRED, "下载凭证无效或已过期");
        }
        Map<String, Object> row = rows.get(0);
        if (offsetDateTime(row.get("expires_at")).isBefore(OffsetDateTime.now())) {
            jdbc.update("update download_tickets set status = 'EXPIRED' where id = ?", row.get("id"));
            throw new BusinessException(ErrorCode.DOWNLOAD_TICKET_EXPIRED, "下载凭证已过期");
        }
        if (row.get("used_at") != null || "USED".equals(row.get("status"))) {
            throw new BusinessException(ErrorCode.DOWNLOAD_TICKET_USED, "下载凭证已使用");
        }
        if (!actor.id().equals(row.get("user_id"))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "下载凭证不属于当前用户");
        }
        String boundDevice = (String) row.get("device_id");
        if (StringUtils.hasText(boundDevice) && !boundDevice.equals(actor.deviceId())) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "下载凭证与设备不匹配");
        }
        if (row.get("extension_id") != null && !"PUBLISHED".equals(String.valueOf(row.get("extension_status")))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "扩展当前不可下载");
        }
        Path path = Path.of(String.valueOf(row.get("storage_path")));
        if (!Files.exists(path)) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "包文件不存在");
        }
        jdbc.update("update download_tickets set used_at = now(), status = 'USED' where id = ?", row.get("id"));
        recordDownloadEvent(actor, row);
        return new DownloadFile(new PathResource(path), String.valueOf(row.get("original_filename")),
                String.valueOf(row.get("sha256")), ((Number) row.get("size_bytes")).longValue());
    }

    private Map<String, Object> issueWithCredentialReplay(CurrentUser actor, DownloadTicketRequest request,
            Map<String, Object> packageObject, String idempotencyKey) {
        String operation = "download-ticket.issue";
        String requestHash = hash(json.write(Map.of("operation", operation, "request", request)));
        var existingRows = jdbc.queryForList("""
                select id, request_hash, response_snapshot::text as response_snapshot, status
                  from idempotency_records
                 where actor_id = ? and operation = ? and idempotency_key = ? for update
                """, actor.id(), operation, idempotencyKey);
        if (!existingRows.isEmpty()) {
            Map<String, Object> existing = existingRows.get(0);
            if (!requestHash.equals(existing.get("request_hash"))) {
                throw new BusinessException(ErrorCode.IDEMPOTENCY_CONFLICT, "同一个 Idempotency-Key 不能用于不同请求");
            }
            Map<String, Object> snapshot = json.readMap((String) existing.get("response_snapshot"));
            Object previousTicketId = snapshot.get("ticketId");
            if (previousTicketId != null) {
                jdbc.update("update download_tickets set status = 'REVOKED' where id = ? and status = 'ISSUED' and used_at is null",
                        UUID.fromString(String.valueOf(previousTicketId)));
            }
            Map<String, Object> response = issueFresh(actor, request, packageObject, idempotencyKey);
            jdbc.update("update idempotency_records set response_snapshot = ?::jsonb, status = 'SUCCEEDED', updated_at = now() where id = ?",
                    json.write(nonSecretSnapshot(response)), existing.get("id"));
            return response;
        }
        UUID recordId = UUID.randomUUID();
        jdbc.update("""
                insert into idempotency_records (id, actor_id, operation, idempotency_key, request_hash, status, expires_at)
                values (?, ?, ?, ?, ?, 'PROCESSING', ?)
                """, recordId, actor.id(), operation, idempotencyKey, requestHash, OffsetDateTime.now().plusHours(24));
        Map<String, Object> response = issueFresh(actor, request, packageObject, idempotencyKey);
        jdbc.update("update idempotency_records set response_snapshot = ?::jsonb, status = 'SUCCEEDED', updated_at = now() where id = ?",
                json.write(nonSecretSnapshot(response)), recordId);
        return response;
    }

    private Map<String, Object> issueFresh(CurrentUser actor, DownloadTicketRequest request, Map<String, Object> packageObject,
            String idempotencyKey) {
        String plaintext = newToken();
        String ticketHash = hash(plaintext);
        UUID ticketId = UUID.randomUUID();
        OffsetDateTime expiresAt = OffsetDateTime.now().plus(properties.getTicketTtl());
        jdbc.update("""
                insert into download_tickets (id, ticket_hash, object_type, object_id, extension_id, extension_business_id,
                  version, purpose, user_id, device_id, issued_request_id, expires_at, status)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED')
                """, ticketId, ticketHash, request.objectType().name(), packageObject.get("id"), packageObject.get("extension_pk"),
                packageObject.get("extension_business_id"), packageObject.get("version"), request.purpose().name(), actor.id(),
                StringUtils.hasText(request.deviceId()) ? request.deviceId() : actor.deviceId(), RequestContext.requireRequestId(), expiresAt);
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .objectType("download_ticket")
                .objectId(ticketId.toString())
                .objectNameSnapshot(String.valueOf(packageObject.get("extension_business_id")))
                .action("download_ticket.issue")
                .result(AuditResult.SUCCESS)
                .afterSummary(Map.of("ticketId", ticketId, "objectId", packageObject.get("id"), "purpose", request.purpose().name(),
                        "expiresAt", expiresAt.toString(), "idempotencyKey", idempotencyKey == null ? "" : "present"))
                .build());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("ticketId", ticketId);
        response.put("ticket", plaintext);
        response.put("downloadUrl", "/api/packages/download?ticket=" + plaintext);
        response.put("expiresAt", expiresAt.toString());
        response.put("sha256", packageObject.get("sha256"));
        response.put("size", packageObject.get("size_bytes"));
        response.put("purpose", request.purpose().name());
        return response;
    }

    private Map<String, Object> nonSecretSnapshot(Map<String, Object> response) {
        Map<String, Object> snapshot = new LinkedHashMap<>(response);
        snapshot.remove("ticket");
        snapshot.remove("downloadUrl");
        snapshot.put("credentialReplayPolicy", "replacement-ticket-issued-on-replay");
        return snapshot;
    }

    private Map<String, Object> resolvePackage(CurrentUser actor, DownloadTicketRequest request) {
        if (request.objectType() != DownloadObjectType.EXTENSION_PACKAGE
                && request.objectType() != DownloadObjectType.EXTERNAL_PLUGIN_FILE
                && request.objectType() != DownloadObjectType.REVIEW_PREVIEW) {
            throw new BusinessException(ErrorCode.DOWNLOAD_PURPOSE_INVALID, "M5 不支持该下载对象类型");
        }
        if (request.objectId() != null) {
            Map<String, Object> row = requirePackageObject(request.objectId());
            if (request.objectType() != DownloadObjectType.REVIEW_PREVIEW
                    && !request.objectType().name().equals(String.valueOf(row.get("object_type")))) {
                throw new BusinessException(ErrorCode.DOWNLOAD_PURPOSE_INVALID, "下载对象类型与包类型不匹配");
            }
            if (request.objectType() == DownloadObjectType.REVIEW_PREVIEW && !actor.isAdmin()) {
                throw new BusinessException(ErrorCode.PERMISSION_DENIED, "仅审核/管理角色可申请预览下载");
            }
            if (row.get("extension_pk") != null) {
                if (request.objectType() == DownloadObjectType.REVIEW_PREVIEW) {
                    requireExtensionVisible(actor, (UUID) row.get("extension_pk"));
                } else {
                    requireExtensionDownloadAllowed(actor, (UUID) row.get("extension_pk"));
                }
            } else if (!actor.id().equals(row.get("created_by")) && !actor.isAdmin()) {
                throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权下载该包");
            }
            return row;
        }
        if (!StringUtils.hasText(request.extensionId())) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 extensionId 或 objectId");
        }
        Map<String, Object> extension = requireExtensionByBusinessId(request.extensionId());
        requireExtensionDownloadAllowed(actor, (UUID) extension.get("id"));
        String version = StringUtils.hasText(request.version()) ? request.version() : String.valueOf(extension.get("current_version"));
        String packageObjectType = request.objectType() == DownloadObjectType.EXTERNAL_PLUGIN_FILE
                ? "EXTERNAL_PLUGIN_FILE" : "EXTENSION_PACKAGE";
        var rows = jdbc.queryForList("""
                select po.* from package_objects po
                 where po.extension_pk = ? and po.version = ? and po.object_type = ?
                 order by po.created_at desc limit 1
                """, extension.get("id"), version, packageObjectType);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "扩展版本包不存在");
        }
        return rows.get(0);
    }

    private void validateM5Boundary(DownloadTicketRequest request) {
        if (request == null || request.objectType() == null || request.purpose() == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "下载凭证请求缺少必要字段");
        }
        if (request.objectType() == DownloadObjectType.CLIENT_UPDATE || request.purpose() == DownloadPurpose.CLIENT_UPDATE) {
            throw new BusinessException(ErrorCode.DOWNLOAD_PURPOSE_INVALID, "M5 不实现客户端更新下载");
        }
        if (request.purpose() == DownloadPurpose.MANUAL_DOWNLOAD && request.objectType() != DownloadObjectType.EXTERNAL_PLUGIN_FILE) {
            throw new BusinessException(ErrorCode.DOWNLOAD_PURPOSE_INVALID, "手动下载目的与对象类型不匹配");
        }
        if ((request.purpose() == DownloadPurpose.INSTALL || request.purpose() == DownloadPurpose.UPDATE)
                && request.objectType() != DownloadObjectType.EXTENSION_PACKAGE) {
            throw new BusinessException(ErrorCode.DOWNLOAD_PURPOSE_INVALID, "安装或更新目的与对象类型不匹配");
        }
        if (request.purpose() == DownloadPurpose.REVIEW_PREVIEW && request.objectType() != DownloadObjectType.REVIEW_PREVIEW) {
            throw new BusinessException(ErrorCode.DOWNLOAD_PURPOSE_INVALID, "审核预览目的与对象类型不匹配");
        }
    }

    private Map<String, Object> requirePackageObject(UUID packageId) {
        var rows = jdbc.queryForList("select * from package_objects where id = ?", packageId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "包不存在");
        }
        return rows.get(0);
    }

    private Map<String, Object> requireExtensionByBusinessId(String extensionId) {
        var rows = jdbc.queryForList("select * from extensions where extension_id = ?", extensionId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "扩展不存在");
        }
        return rows.get(0);
    }

    private void requireExtensionDownloadAllowed(CurrentUser actor, UUID extensionPk) {
        var rows = jdbc.queryForList("select * from extensions where id = ?", extensionPk);
        if (rows.isEmpty() || !visibilityPolicy.isVisible(actor, rows.get(0))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "扩展不可见或无权下载");
        }
        if (!visibilityPolicy.isMainOperationAllowed(actor, rows.get(0))) {
            throw new BusinessException(ErrorCode.SCOPE_RESTRICTED, "授权范围不允许下载该扩展");
        }
    }

    private void requireExtensionVisible(CurrentUser actor, UUID extensionPk) {
        var rows = jdbc.queryForList("select * from extensions where id = ?", extensionPk);
        if (rows.isEmpty() || !visibilityPolicy.isVisible(actor, rows.get(0))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "扩展不可见或无权下载");
        }
    }

    private void recordDownloadEvent(CurrentUser actor, Map<String, Object> ticketRow) {
        String purpose = String.valueOf(ticketRow.get("purpose"));
        String objectType = String.valueOf(ticketRow.get("object_type"));
        if ("CLIENT_UPDATE".equals(purpose) || "CLIENT_UPDATE".equals(objectType)) {
            recordClientUpdateDownloadEvent(actor, ticketRow);
            return;
        }
        String eventType = "INSTALL".equals(purpose) ? "EXTENSION_DOWNLOAD" : "PACKAGE_DOWNLOAD";
        jdbc.update("""
                insert into activity_events (id, event_type, user_id, extension_pk, payload)
                values (?, ?, ?, ?, ?::jsonb)
                """, UUID.randomUUID(), eventType, actor.id(), ticketRow.get("extension_id"),
                json.write(Map.of("purpose", purpose, "ticketId", ticketRow.get("id"), "objectId", ticketRow.get("object_id"))));
    }

    private void requireRegisteredDevice(CurrentUser actor, String deviceId) {
        Long count = jdbc.queryForObject("""
                select count(*) from client_devices
                 where device_id = ? and user_id = ? and status = 'ACTIVE'
                """, Long.class, deviceId, actor.id());
        if (count == null || count == 0) {
            throw new BusinessException(ErrorCode.DEVICE_NOT_FOUND, "设备不存在或不属于当前用户");
        }
    }

    private void recordClientUpdateDownloadEvent(CurrentUser actor, Map<String, Object> ticketRow) {
        var versionRows = jdbc.queryForList("""
                select id, version from client_versions where package_object_id = ?
                """, ticketRow.get("object_id"));
        UUID versionId = versionRows.isEmpty() ? null : (UUID) versionRows.get(0).get("id");
        String version = versionRows.isEmpty() ? String.valueOf(ticketRow.get("version")) : String.valueOf(versionRows.get(0).get("version"));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("ticketId", String.valueOf(ticketRow.get("id")));
        payload.put("objectId", String.valueOf(ticketRow.get("object_id")));
        payload.put("purpose", ticketRow.get("purpose"));
        jdbc.update("""
                insert into client_update_events (id, version_id, device_id, user_id, event_type, result, error_code,
                  request_id, from_version, to_version, payload_summary, occurred_at)
                values (?, ?, ?, ?, 'PACKAGE_DOWNLOADED', 'SUCCESS', null, ?, null, ?, ?::jsonb, ?)
                """, UUID.randomUUID(), versionId, ticketRow.get("device_id"), actor.id(),
                RequestContext.requireRequestId(), version, json.write(payload), OffsetDateTime.now());
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .objectType("client_update")
                .objectId(versionId == null ? null : versionId.toString())
                .objectNameSnapshot(version)
                .action("client_update.package_download")
                .result(AuditResult.SUCCESS)
                .afterSummary(payload)
                .deviceId((String) ticketRow.get("device_id"))
                .clientVersion(actor.clientVersion())
                .build());
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "SHA-256 不可用");
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

    public record DownloadFile(Resource resource, String filename, String sha256, long size) {
    }
}
