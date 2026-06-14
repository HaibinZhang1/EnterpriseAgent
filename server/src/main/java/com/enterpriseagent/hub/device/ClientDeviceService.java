package com.enterpriseagent.hub.device;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
import com.enterpriseagent.hub.organization.DepartmentTreeService;
import com.enterpriseagent.hub.organization.ManagementScopeService;

@Service
public class ClientDeviceService {
    private static final int MAX_PAGE_SIZE = 100;
    private static final Pattern EVENT_TYPE_PATTERN = Pattern.compile("[A-Z0-9_.:-]{1,64}");
    private static final Set<String> EVENT_RESULTS = Set.of("SUCCESS", "FAILURE", "CANCELLED", "PARTIAL_SUCCESS");

    private final JdbcTemplate jdbc;
    private final ExtensionJson json;
    private final ManagementScopeService scopeService;
    private final DepartmentTreeService departmentTreeService;
    private final AuditService auditService;

    public ClientDeviceService(JdbcTemplate jdbc, ExtensionJson json, ManagementScopeService scopeService,
            DepartmentTreeService departmentTreeService, AuditService auditService) {
        this.jdbc = jdbc;
        this.json = json;
        this.scopeService = scopeService;
        this.departmentTreeService = departmentTreeService;
        this.auditService = auditService;
    }

    @Transactional
    public Map<String, Object> register(CurrentUser actor, Map<String, Object> request) {
        String deviceId = required(request, "deviceId");
        String clientVersion = string(request.get("clientVersion"));
        jdbc.update("""
                insert into client_devices (id, device_id, user_id, department_id, user_snapshot, department_snapshot,
                  hostname_hash, os_version, arch, client_version, install_channel, first_seen_at, last_seen_at, status)
                values (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, now(), now(), 'ACTIVE')
                on conflict (device_id) do update set
                  user_id = excluded.user_id,
                  department_id = excluded.department_id,
                  user_snapshot = excluded.user_snapshot,
                  department_snapshot = excluded.department_snapshot,
                  hostname_hash = excluded.hostname_hash,
                  os_version = excluded.os_version,
                  arch = excluded.arch,
                  client_version = excluded.client_version,
                  install_channel = excluded.install_channel,
                  last_seen_at = now(),
                  status = 'ACTIVE',
                  updated_at = now()
                """, UUID.randomUUID(), deviceId, actor.id(), actor.departmentId(), json.write(userSnapshot(actor)),
                json.write(departmentSnapshot(actor)), string(request.get("hostnameHash")), string(request.get("osVersion")),
                string(request.get("arch")), clientVersion, string(request.get("installChannel")));
        insertDeviceEvent(actor, deviceId, "DEVICE_REGISTERED", "SUCCESS", null,
                Map.of("clientVersion", nullToEmpty(clientVersion)), null, OffsetDateTime.now());
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(userSnapshot(actor))
                .actorDepartmentSnapshot(departmentSnapshot(actor))
                .objectType("client_device")
                .objectId(deviceId)
                .objectNameSnapshot(deviceId)
                .action("client_device.register")
                .result(AuditResult.SUCCESS)
                .clientVersion(clientVersion)
                .deviceId(deviceId)
                .afterSummary(Map.of("deviceId", deviceId, "registered", true))
                .build());
        return Map.of("registered", true, "serverTime", OffsetDateTime.now().toString(), "deviceStatus", "ACTIVE",
                "updateHint", Map.of("updateAvailable", false));
    }

    @Transactional
    public Map<String, Object> heartbeat(CurrentUser actor, Map<String, Object> request) {
        String deviceId = required(request, "deviceId");
        int updated = jdbc.update("""
                update client_devices set last_seen_at = now(), client_version = coalesce(?, client_version),
                  status = 'ACTIVE', updated_at = now()
                where device_id = ? and user_id = ?
                """, string(request.get("clientVersion")), deviceId, actor.id());
        if (updated == 0) {
            throw new BusinessException(ErrorCode.DEVICE_NOT_FOUND, "设备不存在或不属于当前用户");
        }
        insertDeviceEvent(actor, deviceId, "HEARTBEAT", "SUCCESS", null,
                Map.of("localEventQueueSize", request.getOrDefault("localEventQueueSize", 0)), null, OffsetDateTime.now());
        return Map.of("accepted", true, "serverTime", OffsetDateTime.now().toString());
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String, Object> events(CurrentUser actor, Map<String, Object> request) {
        String deviceId = required(request, "deviceId");
        requireOwnedActiveDevice(actor, deviceId);
        List<Object> events = request.get("events") instanceof List<?> list ? (List<Object>) list : List.of();
        List<Map<String, Object>> results = new ArrayList<>();
        for (Object raw : events) {
            if (!(raw instanceof Map<?, ?> event)) {
                results.add(Map.of("status", "REJECTED", "errorCode", "invalid_event"));
                continue;
            }
            String key = string(event.get("idempotencyKey"));
            if (!StringUtils.hasText(key)) {
                results.add(Map.of("idempotencyKey", nullToEmpty(key), "status", "REJECTED", "errorCode", "invalid_event"));
                continue;
            }
            String type;
            String errorCode = string(event.get("errorCode"));
            String result;
            OffsetDateTime occurredAt;
            try {
                type = normalizeEventType(event.get("eventType"));
                result = normalizeResult(event.get("result"), errorCode);
                occurredAt = parseOccurredAt(event.get("occurredAt"));
            } catch (EventRejectedException exception) {
                results.add(rejectedDeviceEvent(key, exception));
                continue;
            }
            InsertedDeviceEvent inserted = insertDeviceEvent(actor, deviceId, type, result,
                    errorCode, payload(event.get("payloadSummary")), key, occurredAt);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("idempotencyKey", key);
            item.put("status", inserted.inserted() ? "ACCEPTED" : "IGNORED");
            item.put("result", result);
            item.put("errorCode", errorCode);
            item.put("serverEventId", inserted.inserted() ? inserted.id().toString() : null);
            results.add(item);
            if (inserted.inserted() && shouldAuditDeviceEvent(type, errorCode)) {
                auditService.recordFailure(AuditRecord.builder()
                        .actorId(actor.id())
                        .actorSnapshot(userSnapshot(actor))
                        .actorDepartmentSnapshot(departmentSnapshot(actor))
                        .objectType("client_device_event")
                        .objectId(deviceId)
                        .action("client_device.event." + type.toLowerCase(java.util.Locale.ROOT))
                        .result(AuditResult.FAILURE)
                        .reason(string(event.get("errorCode")))
                        .deviceId(deviceId)
                        .clientVersion(actor.clientVersion())
                        .afterSummary(payload(event.get("payloadSummary")))
                        .build());
            }
        }
        return Map.of("results", results);
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> list(CurrentUser actor, String keyword, String departmentId,
            boolean includeChildren, String clientVersion, String status, int page, int pageSize) {
        requireAdmin(actor);
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" where 1 = 1");
        Set<UUID> departmentFilter = departmentFilter(actor, departmentId, includeChildren);
        if (departmentFilter != null && departmentFilter.isEmpty()) {
            return page(List.of(), safePage(page), safePageSize(pageSize), 0);
        }
        if (departmentFilter != null) {
            appendUuidFilter(where, params, "department_id", departmentFilter);
        }
        if (StringUtils.hasText(keyword)) {
            where.append(" and device_id like ?");
            params.add("%" + keyword + "%");
        }
        if (StringUtils.hasText(clientVersion)) {
            where.append(" and client_version = ?");
            params.add(clientVersion);
        }
        if (StringUtils.hasText(status)) {
            where.append(" and status = ?");
            params.add(status);
        }
        long total = count("select count(*) from client_devices" + where, params);
        int safePage = safePage(page);
        int safePageSize = safePageSize(pageSize);
        List<Object> queryParams = new ArrayList<>(params);
        queryParams.add(safePageSize);
        queryParams.add(offset(safePage, safePageSize));
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select device_id, user_id, department_id, user_snapshot::text as user_snapshot,
                       department_snapshot::text as department_snapshot, hostname_hash, os_version, arch,
                       client_version, first_seen_at, last_seen_at, status, recent_update_status, recent_error_summary
                  from client_devices
                """ + where + " order by last_seen_at desc limit ? offset ?", queryParams.toArray()).stream()
                .map(this::decodeDeviceRow)
                .toList();
        return page(rows, safePage, safePageSize, total);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> versionDistribution(CurrentUser actor, String departmentId, boolean includeChildren) {
        requireAdmin(actor);
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" where 1 = 1");
        Set<UUID> departmentFilter = departmentFilter(actor, departmentId, includeChildren);
        if (departmentFilter != null && departmentFilter.isEmpty()) {
            return List.of();
        }
        if (departmentFilter != null) {
            appendUuidFilter(where, params, "department_id", departmentFilter);
        }
        return jdbc.queryForList("""
                select coalesce(client_version, 'unknown') as client_version,
                       count(*) as device_count,
                       count(*) filter (where status = 'ACTIVE') as active_count,
                       max(last_seen_at) as last_seen_at
                  from client_devices
                """ + where + """
                 group by coalesce(client_version, 'unknown')
                 order by device_count desc, client_version asc
                """, params.toArray()).stream()
                .map(row -> {
                    Map<String, Object> output = new LinkedHashMap<>();
                    output.put("clientVersion", row.get("client_version"));
                    output.put("deviceCount", row.get("device_count"));
                    output.put("activeCount", row.get("active_count"));
                    output.put("lastSeenAt", row.get("last_seen_at"));
                    return output;
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(CurrentUser actor, String deviceId) {
        requireAdmin(actor);
        var rows = jdbc.queryForList("""
                select device_id, user_id, department_id, user_snapshot::text as user_snapshot,
                       department_snapshot::text as department_snapshot, hostname_hash, os_version, arch,
                       client_version, first_seen_at, last_seen_at, status, recent_update_status, recent_error_summary
                  from client_devices where device_id = ?
                """, deviceId);
        if (rows.isEmpty() || !visible(actor, (UUID) rows.get(0).get("department_id"))) {
            throw new BusinessException(ErrorCode.DEVICE_NOT_FOUND, "设备不存在或无权查看");
        }
        Map<String, Object> detail = decodeDeviceRow(rows.get(0));
        detail.put("events", jdbc.queryForList("""
                select event_type, result, error_code, request_id, payload_summary::text as payload_summary, occurred_at, created_at
                  from client_device_events where device_id = ? order by created_at desc limit 20
                """, deviceId).stream().map(this::decodeEventRow).toList());
        detail.put("updateEvents", jdbc.queryForList("""
                select event_type, result, error_code, request_id, from_version, to_version, payload_summary::text as payload_summary, occurred_at, created_at
                  from client_update_events where device_id = ? order by created_at desc limit 20
                """, deviceId).stream().map(this::decodeEventRow).toList());
        return detail;
    }

    private InsertedDeviceEvent insertDeviceEvent(CurrentUser actor, String deviceId, String type, String result, String errorCode,
            Map<String, Object> payload, String idempotencyKey, OffsetDateTime occurredAt) {
        String key = StringUtils.hasText(idempotencyKey) ? idempotencyKey : deviceId + ":" + type + ":" + RequestContext.requireRequestId();
        UUID eventId = UUID.randomUUID();
        int inserted = jdbc.update("""
                insert into client_device_events (id, device_id, user_id, department_id, idempotency_key, event_type,
                  result, error_code, request_id, local_event_id, payload_summary, occurred_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)
                on conflict (device_id, idempotency_key) do nothing
                """, eventId, deviceId, actor.id(), actor.departmentId(), key, type, result, errorCode,
                RequestContext.requireRequestId(), string(payload.get("localEventId")), json.write(payload), occurredAt);
        return new InsertedDeviceEvent(eventId, inserted == 1);
    }

    private boolean shouldAuditDeviceEvent(String type, String errorCode) {
        return StringUtils.hasText(errorCode) || type.contains("FAILED") || type.contains("SIGNATURE") || type.contains("HASH");
    }

    private Map<String, Object> decodeDeviceRow(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>(row);
        output.put("userSnapshot", json.read((String) output.remove("user_snapshot")));
        output.put("departmentSnapshot", json.read((String) output.remove("department_snapshot")));
        output.put("deviceId", output.get("device_id"));
        output.put("userId", output.get("user_id"));
        output.put("departmentId", output.get("department_id"));
        output.put("hostnameHash", output.get("hostname_hash"));
        output.put("osVersion", output.get("os_version"));
        output.put("clientVersion", output.get("client_version"));
        output.put("firstSeenAt", output.get("first_seen_at"));
        output.put("lastSeenAt", output.get("last_seen_at"));
        output.put("recentUpdateStatus", output.get("recent_update_status"));
        output.put("recentErrorSummary", output.get("recent_error_summary"));
        return output;
    }

    private Map<String, Object> decodeEventRow(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>(row);
        if (output.containsKey("payload_summary")) {
            output.put("payloadSummary", json.read((String) output.remove("payload_summary")));
        }
        return output;
    }

    private void requireOwnedActiveDevice(CurrentUser actor, String deviceId) {
        Long count = jdbc.queryForObject("""
                select count(*) from client_devices
                 where device_id = ? and user_id = ? and status = 'ACTIVE'
                """, Long.class, deviceId, actor.id());
        if (count == null || count == 0) {
            throw new BusinessException(ErrorCode.DEVICE_NOT_FOUND, "设备不存在或不属于当前用户");
        }
    }

    private boolean visible(CurrentUser actor, UUID departmentId) {
        return actor.isSystemAdmin() || scopeService.canViewDepartment(actor, departmentId);
    }

    private Set<UUID> departmentFilter(CurrentUser actor, String departmentId, boolean includeChildren) {
        Set<UUID> visible = actor.isSystemAdmin()
                ? null
                : departmentTreeService.selfAndDescendantIds(actor.departmentId(), true);
        Set<UUID> selected;
        if (StringUtils.hasText(departmentId)) {
            UUID targetDepartmentId = parseDepartmentId(departmentId);
            if (!scopeService.canViewDepartment(actor, targetDepartmentId)) {
                return Set.of();
            }
            selected = includeChildren
                    ? departmentTreeService.selfAndDescendantIds(targetDepartmentId, true)
                    : Set.of(targetDepartmentId);
        } else if (visible == null) {
            return null;
        } else {
            selected = visible;
        }
        if (visible == null) {
            return selected;
        }
        Set<UUID> intersection = new HashSet<>(selected);
        intersection.retainAll(visible);
        return intersection;
    }

    private UUID parseDepartmentId(String departmentId) {
        try {
            return UUID.fromString(departmentId);
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "departmentId 无效");
        }
    }

    private void appendUuidFilter(StringBuilder where, List<Object> params, String column, Set<UUID> ids) {
        if (ids.isEmpty()) {
            return;
        }
        where.append(" and ").append(column).append(" in (");
        where.append("?,".repeat(ids.size()));
        where.setLength(where.length() - 1);
        where.append(")");
        params.addAll(ids);
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

    private void requireAdmin(CurrentUser actor) {
        if (!actor.isAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权查看客户端设备");
        }
    }

    private Map<String, Object> userSnapshot(CurrentUser actor) {
        return Map.of("id", actor.id().toString(), "name", actor.name(), "role", actor.role().name());
    }

    private Map<String, Object> departmentSnapshot(CurrentUser actor) {
        return Map.of("id", actor.departmentId().toString(), "name", actor.departmentName());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> payload(Object value) {
        return value instanceof Map<?, ?> map ? new LinkedHashMap<>((Map<String, Object>) map) : Map.of();
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

    private String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private String normalizeEventType(Object value) {
        String type = string(value);
        if (!StringUtils.hasText(type)) {
            throw new EventRejectedException("invalid_event_type", null);
        }
        String normalized = type.trim().toUpperCase(java.util.Locale.ROOT);
        if (!EVENT_TYPE_PATTERN.matcher(normalized).matches()) {
            throw new EventRejectedException("invalid_event_type", null);
        }
        return normalized;
    }

    private String normalizeResult(Object value, String errorCode) {
        String result = string(value);
        if (!StringUtils.hasText(result) && StringUtils.hasText(errorCode)) {
            return "FAILURE";
        }
        if (!StringUtils.hasText(result)) {
            throw new EventRejectedException("invalid_result", null);
        }
        String normalized = result.trim().toUpperCase(java.util.Locale.ROOT);
        if (!EVENT_RESULTS.contains(normalized)) {
            throw new EventRejectedException("invalid_result", normalized);
        }
        if ("SUCCESS".equals(normalized) && StringUtils.hasText(errorCode)) {
            throw new EventRejectedException("invalid_result", normalized);
        }
        return normalized;
    }

    private OffsetDateTime parseOccurredAt(Object value) {
        String occurredAt = string(value);
        if (!StringUtils.hasText(occurredAt)) {
            return OffsetDateTime.now();
        }
        try {
            return OffsetDateTime.parse(occurredAt);
        } catch (RuntimeException exception) {
            throw new EventRejectedException("invalid_occurred_at", null);
        }
    }

    private Map<String, Object> rejectedDeviceEvent(String idempotencyKey, EventRejectedException exception) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("idempotencyKey", nullToEmpty(idempotencyKey));
        response.put("status", "REJECTED");
        response.put("result", exception.result());
        response.put("errorCode", exception.errorCode());
        response.put("serverEventId", null);
        return response;
    }

    private record InsertedDeviceEvent(UUID id, boolean inserted) {
    }

    private static final class EventRejectedException extends RuntimeException {
        private final String errorCode;
        private final String result;

        private EventRejectedException(String errorCode, String result) {
            super(errorCode);
            this.errorCode = errorCode;
            this.result = result;
        }

        private String errorCode() {
            return errorCode;
        }

        private String result() {
            return result;
        }
    }
}
