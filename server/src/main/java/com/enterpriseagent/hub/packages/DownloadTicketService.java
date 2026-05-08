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
        if (request.objectType() != DownloadObjectType.EXTENSION_PACKAGE && request.objectType() != DownloadObjectType.REVIEW_PREVIEW) {
            throw new BusinessException(ErrorCode.DOWNLOAD_PURPOSE_INVALID, "M5 不支持该下载对象类型");
        }
        if (request.objectId() != null) {
            Map<String, Object> row = requirePackageObject(request.objectId());
            if (request.objectType() == DownloadObjectType.REVIEW_PREVIEW && !actor.isAdmin()) {
                throw new BusinessException(ErrorCode.PERMISSION_DENIED, "仅审核/管理角色可申请预览下载");
            }
            if (row.get("extension_pk") != null) {
                requireExtensionVisible(actor, (UUID) row.get("extension_pk"));
            } else if (!actor.id().equals(row.get("created_by")) && !actor.isAdmin()) {
                throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权下载该包");
            }
            return row;
        }
        if (!StringUtils.hasText(request.extensionId())) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 extensionId 或 objectId");
        }
        Map<String, Object> extension = requireExtensionByBusinessId(request.extensionId());
        requireExtensionVisible(actor, (UUID) extension.get("id"));
        if (!"PUBLISHED".equals(String.valueOf(extension.get("status")))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "扩展当前不可下载");
        }
        String version = StringUtils.hasText(request.version()) ? request.version() : String.valueOf(extension.get("current_version"));
        var rows = jdbc.queryForList("""
                select po.* from package_objects po
                 where po.extension_pk = ? and po.version = ? and po.object_type = 'EXTENSION_PACKAGE'
                 order by po.created_at desc limit 1
                """, extension.get("id"), version);
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

    private void requireExtensionVisible(CurrentUser actor, UUID extensionPk) {
        var rows = jdbc.queryForList("select * from extensions where id = ?", extensionPk);
        if (rows.isEmpty() || !visibilityPolicy.isVisible(actor, rows.get(0))) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "扩展不可见或无权下载");
        }
    }

    private void recordDownloadEvent(CurrentUser actor, Map<String, Object> ticketRow) {
        String purpose = String.valueOf(ticketRow.get("purpose"));
        String eventType = "INSTALL".equals(purpose) ? "EXTENSION_DOWNLOAD" : "PACKAGE_DOWNLOAD";
        jdbc.update("""
                insert into activity_events (id, event_type, user_id, extension_pk, payload)
                values (?, ?, ?, ?, ?::jsonb)
                """, UUID.randomUUID(), eventType, actor.id(), ticketRow.get("extension_id"),
                json.write(Map.of("purpose", purpose, "ticketId", ticketRow.get("id"), "objectId", ticketRow.get("object_id"))));
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
