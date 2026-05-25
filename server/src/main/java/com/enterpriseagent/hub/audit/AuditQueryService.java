package com.enterpriseagent.hub.audit;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
import com.enterpriseagent.hub.organization.DepartmentTreeService;
import com.enterpriseagent.hub.organization.ManagementScopeService;

@Service
public class AuditQueryService {
    private static final int MAX_PAGE_SIZE = 100;

    private final JdbcTemplate jdbc;
    private final ExtensionJson json;
    private final ManagementScopeService scopeService;
    private final DepartmentTreeService departmentTreeService;
    private final AuditService auditService;

    public AuditQueryService(JdbcTemplate jdbc, ExtensionJson json, ManagementScopeService scopeService,
            DepartmentTreeService departmentTreeService, AuditService auditService) {
        this.jdbc = jdbc;
        this.json = json;
        this.scopeService = scopeService;
        this.departmentTreeService = departmentTreeService;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> query(CurrentUser actor, Query query) {
        requireAdmin(actor);
        SqlFilter filter = buildFilter(actor, query);
        long total = count("select count(*) from audit_logs" + filter.where(), filter.params());
        int safePage = safePage(query.page());
        int safePageSize = safePageSize(query.pageSize());
        List<Map<String, Object>> rows = queryRows(filter, safePage, safePageSize);
        return page(rows, safePage, safePageSize, total);
    }

    @Transactional
    public String exportCsv(CurrentUser actor, Query query) {
        requireAdmin(actor);
        SqlFilter filter = buildFilter(actor, query.withoutPaging());
        List<Map<String, Object>> rows = queryRows(filter, 1, Integer.MAX_VALUE);
        StringBuilder csv = new StringBuilder("createdAt,requestId,actorId,deviceId,objectType,objectId,action,result,reason\n");
        for (Map<String, Object> row : rows) {
            csv.append(csv(row.get("createdAt"))).append(',')
                    .append(csv(row.get("requestId"))).append(',')
                    .append(csv(row.get("actorId"))).append(',')
                    .append(csv(row.get("deviceId"))).append(',')
                    .append(csv(row.get("objectType"))).append(',')
                    .append(csv(row.get("objectId"))).append(',')
                    .append(csv(row.get("action"))).append(',')
                    .append(csv(row.get("result"))).append(',')
                    .append(csv(row.get("reason"))).append('\n');
        }
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(Map.of("id", actor.id().toString(), "name", actor.name(), "role", actor.role().name()))
                .actorDepartmentSnapshot(Map.of("id", actor.departmentId().toString(), "name", actor.departmentName()))
                .objectType("audit_log")
                .objectId("export")
                .objectNameSnapshot("audit-logs.csv")
                .action("audit.export")
                .result(AuditResult.SUCCESS)
                .afterSummary(Map.of("filters", query.filterSummary(), "rowCount", rows.size()))
                .build());
        return csv.toString();
    }

    private List<Map<String, Object>> queryRows(SqlFilter filter, int page, int pageSize) {
        List<Object> params = new ArrayList<>(filter.params());
        params.add(pageSize);
        params.add(pageSize == Integer.MAX_VALUE ? 0 : offset(page, pageSize));
        return jdbc.queryForList("""
                select id, request_id, actor_id, actor_snapshot::text as actor_snapshot,
                       actor_department_snapshot::text as actor_department_snapshot, object_type, object_id,
                       object_name_snapshot, action, result, reason, before_summary::text as before_summary,
                       after_summary::text as after_summary, ip, user_agent, client_version, device_id, created_at
                  from audit_logs
                """ + filter.where() + " order by created_at desc limit ? offset ?", params.toArray()).stream()
                .map(this::auditRow)
                .toList();
    }

    private SqlFilter buildFilter(CurrentUser actor, Query query) {
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" where 1 = 1");
        if (!actor.isSystemAdmin()) {
            Set<UUID> visibleDepartments = departmentTreeService.selfAndDescendantIds(actor.departmentId(), true);
            if (visibleDepartments.isEmpty()) {
                where.append(" and 1 = 0");
            } else {
                where.append(" and (actor_id in (select id from users where ");
                appendUuidFilter(where, params, "department_id", visibleDepartments);
                where.append(") or device_id in (select device_id from client_devices where ");
                appendUuidFilter(where, params, "department_id", visibleDepartments);
                where.append("))");
            }
        }
        if (StringUtils.hasText(query.requestId())) {
            where.append(" and request_id = ?");
            params.add(query.requestId());
        }
        if (query.actorId() != null) {
            where.append(" and actor_id = ?");
            params.add(query.actorId());
        }
        if (StringUtils.hasText(query.deviceId())) {
            where.append(" and device_id = ?");
            params.add(query.deviceId());
        }
        if (StringUtils.hasText(query.objectType())) {
            where.append(" and object_type = ?");
            params.add(query.objectType());
        }
        if (StringUtils.hasText(query.objectId())) {
            where.append(" and object_id = ?");
            params.add(query.objectId());
        }
        if (StringUtils.hasText(query.action())) {
            where.append(" and action like ?");
            params.add("%" + query.action() + "%");
        }
        if (StringUtils.hasText(query.result())) {
            where.append(" and result = ?");
            params.add(query.result());
        }
        OffsetDateTime from = parseTime(query.from());
        if (from != null) {
            where.append(" and created_at >= ?");
            params.add(from);
        }
        OffsetDateTime to = parseTime(query.to());
        if (to != null) {
            where.append(" and created_at <= ?");
            params.add(to);
        }
        return new SqlFilter(where.toString(), params);
    }

    private Map<String, Object> auditRow(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("id", row.get("id"));
        output.put("requestId", row.get("request_id"));
        output.put("actorId", row.get("actor_id"));
        output.put("actorSnapshot", json.read((String) row.get("actor_snapshot")));
        output.put("actorDepartmentSnapshot", json.read((String) row.get("actor_department_snapshot")));
        output.put("objectType", row.get("object_type"));
        output.put("objectId", row.get("object_id"));
        output.put("objectNameSnapshot", row.get("object_name_snapshot"));
        output.put("action", row.get("action"));
        output.put("result", row.get("result"));
        output.put("reason", row.get("reason"));
        output.put("beforeSummary", json.read((String) row.get("before_summary")));
        output.put("afterSummary", json.read((String) row.get("after_summary")));
        output.put("ip", row.get("ip"));
        output.put("userAgent", row.get("user_agent"));
        output.put("clientVersion", row.get("client_version"));
        output.put("deviceId", row.get("device_id"));
        output.put("createdAt", row.get("created_at"));
        return output;
    }

    private void requireAdmin(CurrentUser actor) {
        if (!actor.isAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权查看审计日志");
        }
    }

    private void appendUuidFilter(StringBuilder where, List<Object> params, String column, Set<UUID> ids) {
        where.append(column).append(" in (");
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

    private OffsetDateTime parseTime(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        return OffsetDateTime.parse(value);
    }

    private OffsetDateTime offsetDateTime(Object value) {
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant().atOffset(ZoneOffset.UTC);
        }
        return OffsetDateTime.parse(String.valueOf(value));
    }

    private String csv(Object value) {
        String text = value == null ? "" : String.valueOf(value);
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }

    private record SqlFilter(String where, List<Object> params) {
    }

    public record Query(
            String requestId,
            UUID actorId,
            String deviceId,
            String objectType,
            String objectId,
            String action,
            String result,
            String from,
            String to,
            int page,
            int pageSize) {
        Query withoutPaging() {
            return new Query(requestId, actorId, deviceId, objectType, objectId, action, result, from, to, 1, Integer.MAX_VALUE);
        }

        Map<String, Object> filterSummary() {
            Map<String, Object> filters = new LinkedHashMap<>();
            putIfPresent(filters, "requestId", requestId);
            putIfPresent(filters, "actorId", actorId);
            putIfPresent(filters, "deviceId", deviceId);
            putIfPresent(filters, "objectType", objectType);
            putIfPresent(filters, "objectId", objectId);
            putIfPresent(filters, "action", action);
            putIfPresent(filters, "result", result);
            putIfPresent(filters, "from", from);
            putIfPresent(filters, "to", to);
            return filters;
        }

        private static void putIfPresent(Map<String, Object> filters, String key, Object value) {
            if (value == null) {
                return;
            }
            if (value instanceof String string && !StringUtils.hasText(string)) {
                return;
            }
            filters.put(key, value);
        }
    }
}
