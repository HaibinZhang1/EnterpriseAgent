package com.enterpriseagent.hub.settings;

import java.util.ArrayList;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

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
import com.enterpriseagent.hub.extension.ExtensionJson;

@Service
public class SettingsService {
    private static final String MASK = "***MASKED***";
    private static final int MAX_PAGE_SIZE = 100;
    private static final Set<String> LIST_KEYS = Set.of("categories", "tags");
    private static final Set<String> OBJECT_KEYS = Set.of(
            "upload.limits",
            "password.policy",
            "session.policy",
            "audit.retention",
            "ai.precheck",
            "mcp.write.policy",
            "plugin.install.policy",
            "client.update.policy",
            "security.delist.policy");
    private static final Set<String> ALLOWED_KEYS = java.util.stream.Stream.concat(LIST_KEYS.stream(), OBJECT_KEYS.stream())
            .collect(java.util.stream.Collectors.toUnmodifiableSet());

    private final JdbcTemplate jdbc;
    private final ExtensionJson json;
    private final AuditService auditService;

    public SettingsService(JdbcTemplate jdbc, ExtensionJson json, AuditService auditService) {
        this.jdbc = jdbc;
        this.json = json;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> list(CurrentUser actor, String keyword, int page, int pageSize) {
        requireSystemAdmin(actor);
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" where 1 = 1");
        if (StringUtils.hasText(keyword)) {
            where.append(" and key like ?");
            params.add("%" + keyword + "%");
        }
        long total = count("select count(*) from settings" + where, params);
        int safePage = safePage(page);
        int safePageSize = safePageSize(pageSize);
        List<Object> queryParams = new ArrayList<>(params);
        queryParams.add(safePageSize);
        queryParams.add(offset(safePage, safePageSize));
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select key, value::text as value, version, updated_by, updated_at
                  from settings
                """ + where + " order by key asc limit ? offset ?", queryParams.toArray()).stream()
                .map(this::settingRow)
                .toList();
        return new PageResult<>(rows, safePage, safePageSize, total, offset(safePage, safePageSize) + rows.size() < total);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> get(CurrentUser actor, String key) {
        requireSystemAdmin(actor);
        return jdbc.queryForList("""
                select key, value::text as value, version, updated_by, updated_at
                  from settings where key = ?
                """, key).stream().findFirst().map(this::settingRow)
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "设置不存在"));
    }

    @Transactional
    public Map<String, Object> update(CurrentUser actor, String key, Map<String, Object> request) {
        requireSystemAdmin(actor);
        if (!StringUtils.hasText(key) || key.length() > 128) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "设置 key 无效");
        }
        requireAllowedKey(key);
        if (!request.containsKey("value")) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 value");
        }
        String reason = string(request.get("reason"));
        if (!StringUtils.hasText(reason)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 reason");
        }
        Integer expectedVersion = integer(request.get("expectedVersion"));
        if (expectedVersion == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "缺少 expectedVersion");
        }
        Object value = validateValue(key, request.get("value"));
        Map<String, Object> before = jdbc.queryForList("""
                select key, value::text as value, version, updated_by, updated_at
                  from settings where key = ? for update
                """, key).stream().findFirst().orElse(null);
        int beforeVersion = before == null ? 0 : ((Number) before.get("version")).intValue();
        if (beforeVersion != expectedVersion) {
            throw new BusinessException(ErrorCode.SETTING_VERSION_CONFLICT, "设置版本已变化",
                    Map.of("expectedVersion", expectedVersion, "currentVersion", beforeVersion));
        }
        int nextVersion = beforeVersion + 1;
        if (before == null) {
            jdbc.update("""
                    insert into settings (key, value, version, updated_by, updated_at)
                    values (?, ?::jsonb, ?, ?, now())
                    """, key, json.write(value), nextVersion, actor.id());
        } else {
            jdbc.update("""
                    update settings set value = ?::jsonb, version = ?, updated_by = ?, updated_at = now()
                     where key = ?
                    """, json.write(value), nextVersion, actor.id(), key);
        }
        jdbc.update("""
                insert into settings_history (id, key, before_value, after_value, before_version, after_version,
                  reason, updated_by, actor_snapshot)
                values (?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?::jsonb)
                """, UUID.randomUUID(), key, before == null ? null : before.get("value"), json.write(value),
                beforeVersion == 0 ? null : beforeVersion, nextVersion, reason, actor.id(), json.write(actorSnapshot(actor)));
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(actorSnapshot(actor))
                .objectType("settings")
                .objectId(key)
                .objectNameSnapshot(key)
                .action("settings.update")
                .result(AuditResult.SUCCESS)
                .reason(reason)
                .beforeSummary(beforeSummary(key, before))
                .afterSummary(Map.of("key", key, "version", nextVersion, "value", redactValue(key, value)))
                .build());
        return get(actor, key);
    }

    private Map<String, Object> settingRow(Map<String, Object> row) {
        String key = String.valueOf(row.get("key"));
        Object value = json.read((String) row.get("value"));
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("key", key);
        output.put("value", redactValue(key, value));
        output.put("version", row.get("version"));
        output.put("updatedBy", row.get("updated_by"));
        output.put("updatedAt", row.get("updated_at"));
        return output;
    }

    private Map<String, Object> beforeSummary(String key, Map<String, Object> before) {
        if (before == null) {
            return Map.of("key", key, "exists", false, "version", 0);
        }
        return Map.of("key", key, "exists", true, "version", before.get("version"),
                "value", redactValue(key, json.read((String) before.get("value"))));
    }

    @SuppressWarnings("unchecked")
    private Object redactValue(String key, Object value) {
        if (isSensitive(key)) {
            return MASK;
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> output = new LinkedHashMap<>();
            map.forEach((nestedKey, nestedValue) -> {
                String nested = String.valueOf(nestedKey);
                output.put(nested, isSensitive(nested) ? MASK : redactValue(nested, nestedValue));
            });
            return output;
        }
        if (value instanceof List<?> list) {
            List<Object> output = new ArrayList<>();
            for (Object item : list) {
                output.add(redactValue(key, item));
            }
            return output;
        }
        return value;
    }

    private boolean isSensitive(String key) {
        String normalized = key.toLowerCase(Locale.ROOT);
        return normalized.contains("password")
                || normalized.contains("token")
                || normalized.contains("secret")
                || normalized.contains("credential")
                || normalized.equals("key")
                || normalized.endsWith("key");
    }

    private Map<String, Object> actorSnapshot(CurrentUser actor) {
        return Map.of("id", actor.id().toString(), "name", actor.name(), "role", actor.role().name());
    }

    private void requireAllowedKey(String key) {
        if (!ALLOWED_KEYS.contains(key)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "设置 key 不在允许列表中");
        }
    }

    private Object validateValue(String key, Object value) {
        if (LIST_KEYS.contains(key)) {
            if (!(value instanceof List<?> list) || list.stream().anyMatch(item -> !(item instanceof String))) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, key + " 必须是字符串数组");
            }
            return value;
        }
        if (OBJECT_KEYS.contains(key)) {
            if (!(value instanceof Map<?, ?>)) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, key + " 必须是对象");
            }
            return value;
        }
        throw new BusinessException(ErrorCode.VALIDATION_FAILED, "设置 key 不在允许列表中");
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

    private void requireSystemAdmin(CurrentUser actor) {
        if (!actor.isSystemAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "仅系统管理员可管理设置");
        }
    }

    private Integer integer(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value == null || !StringUtils.hasText(String.valueOf(value))) {
            return null;
        }
        return Integer.parseInt(String.valueOf(value));
    }

    private String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
