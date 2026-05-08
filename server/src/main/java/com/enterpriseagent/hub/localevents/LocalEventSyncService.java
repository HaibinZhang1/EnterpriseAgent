package com.enterpriseagent.hub.localevents;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.extension.ExtensionJson;
import com.enterpriseagent.hub.localevents.LocalEventSyncResponse.LocalEventResult;
import com.enterpriseagent.hub.localevents.LocalEventSyncResponse.LocalEventStatus;
import com.enterpriseagent.hub.localevents.LocalEventSyncResponse.ServerStateHint;

@Service
public class LocalEventSyncService {
    private static final Pattern SENSITIVE_KEY = Pattern.compile("(?i)(authorization|token|ticket|password|api[_-]?key|secret|credential)");

    private final JdbcTemplate jdbc;
    private final ExtensionJson json;

    public LocalEventSyncService(JdbcTemplate jdbc, ExtensionJson json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public LocalEventSyncResponse sync(CurrentUser actor, LocalEventSyncRequest request) {
        String deviceId = StringUtils.hasText(request == null ? null : request.deviceId())
                ? request.deviceId()
                : actor.deviceId();
        List<LocalEventResult> results = new ArrayList<>();
        List<ServerStateHint> hints = new ArrayList<>();
        if (!StringUtils.hasText(deviceId)) {
            for (LocalEventSyncRequest.LocalEventItem event : safeEvents(request)) {
                results.add(new LocalEventResult(event.idempotencyKey(), LocalEventStatus.REJECTED, null, "device_id_required"));
            }
            return new LocalEventSyncResponse(results, hints);
        }

        for (LocalEventSyncRequest.LocalEventItem event : safeEvents(request)) {
            if (!StringUtils.hasText(event.idempotencyKey()) || !StringUtils.hasText(event.type())) {
                results.add(new LocalEventResult(event.idempotencyKey(), LocalEventStatus.REJECTED, null, "invalid_event"));
                continue;
            }
            UUID existing = existing(deviceId, event.idempotencyKey());
            if (existing != null) {
                results.add(new LocalEventResult(event.idempotencyKey(), LocalEventStatus.IGNORED, existing, null));
                continue;
            }
            UUID serverEventId = UUID.randomUUID();
            UUID extensionPk = extensionPk(event.extensionId());
            try {
                jdbc.update("""
                        insert into local_events (id, user_id, device_id, extension_pk, extension_business_id, version,
                          event_type, idempotency_key, result, error_code, payload_summary, occurred_at, synced_at)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, now())
                        """,
                        serverEventId, actor.id(), deviceId, extensionPk, emptyToNull(event.extensionId()),
                        emptyToNull(event.version()), event.type(), event.idempotencyKey(), emptyToNull(event.result()),
                        emptyToNull(event.errorCode()), json.write(redactMap(event.payloadSummary())),
                        event.occurredAt() == null ? OffsetDateTime.now() : event.occurredAt());
            } catch (DataIntegrityViolationException exception) {
                UUID duplicate = existing(deviceId, event.idempotencyKey());
                results.add(new LocalEventResult(event.idempotencyKey(), LocalEventStatus.IGNORED, duplicate, null));
                continue;
            }
            addStateHintIfNeeded(event.extensionId(), hints);
            results.add(new LocalEventResult(event.idempotencyKey(), LocalEventStatus.ACCEPTED, serverEventId, null));
        }
        return new LocalEventSyncResponse(results, hints);
    }

    private List<LocalEventSyncRequest.LocalEventItem> safeEvents(LocalEventSyncRequest request) {
        return request == null || request.events() == null ? List.of() : request.events();
    }

    private UUID existing(String deviceId, String idempotencyKey) {
        List<UUID> rows = jdbc.queryForList("""
                select id from local_events where device_id = ? and idempotency_key = ?
                """, UUID.class, deviceId, idempotencyKey);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private UUID extensionPk(String extensionId) {
        if (!StringUtils.hasText(extensionId)) return null;
        List<UUID> rows = jdbc.queryForList("select id from extensions where extension_id = ?", UUID.class, extensionId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private void addStateHintIfNeeded(String extensionId, List<ServerStateHint> hints) {
        if (!StringUtils.hasText(extensionId)) return;
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select status from extensions where extension_id = ?
                """, extensionId);
        if (rows.isEmpty()) return;
        String status = String.valueOf(rows.get(0).get("status"));
        if ("DELISTED".equals(status) || "SECURITY_DELISTED".equals(status) || "ARCHIVED".equals(status)) {
            hints.add(new ServerStateHint(extensionId, status, "扩展状态已变化，请刷新本地状态"));
        }
    }

    private Object redactValue(Object value, String keyHint) {
        if (keyHint != null && SENSITIVE_KEY.matcher(keyHint).find()) return "[REDACTED]";
        if (value instanceof Map<?, ?> map) {
            return redactMap(map);
        }
        if (value instanceof List<?> list) {
            return list.stream().map(item -> redactValue(item, null)).toList();
        }
        if (value instanceof String text && SENSITIVE_KEY.matcher(text).find()) return "[REDACTED]";
        return value;
    }

    private Map<String, Object> redactMap(Map<?, ?> input) {
        if (input == null) return Map.of();
        return input.entrySet().stream()
                .collect(java.util.stream.Collectors.toMap(entry -> String.valueOf(entry.getKey()),
                        entry -> redactValue(entry.getValue(), String.valueOf(entry.getKey())),
                        (left, right) -> right, java.util.LinkedHashMap::new));
    }

    private String emptyToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }
}
