package com.enterpriseagent.hub.extension;

import java.util.ArrayList;
import java.util.Comparator;
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
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.common.pagination.PageResult;
import com.enterpriseagent.hub.organization.DepartmentTreeService;

@Service
public class ExtensionCatalogService {
    private final JdbcTemplate jdbc;
    private final VisibilityPolicy visibilityPolicy;
    private final ExtensionJson json;
    private final DepartmentTreeService departmentTreeService;

    public ExtensionCatalogService(JdbcTemplate jdbc, VisibilityPolicy visibilityPolicy, ExtensionJson json,
            DepartmentTreeService departmentTreeService) {
        this.jdbc = jdbc;
        this.visibilityPolicy = visibilityPolicy;
        this.json = json;
        this.departmentTreeService = departmentTreeService;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> communityHome(CurrentUser actor) {
        List<Map<String, Object>> publicItems = rows("""
                where e.status = 'PUBLISHED' and e.visibility_mode = 'PUBLIC_TO_ALL_LOGGED_IN'
                """).stream()
                .map(row -> card(actor, row))
                .toList();
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("skill", bucket(publicItems, "SKILL"));
        response.put("mcpServer", bucket(publicItems, "MCP_SERVER"));
        response.put("plugin", bucket(publicItems, "PLUGIN"));
        return response;
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> search(CurrentUser actor, String q, ExtensionType type, int page, int pageSize) {
        String normalized = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        List<Map<String, Object>> items = rows("where e.status = 'PUBLISHED'").stream()
                .filter(row -> type == null || type.name().equals(row.get("type")))
                .filter(row -> visibilityPolicy.isVisible(actor, row))
                .filter(row -> !StringUtils.hasText(normalized)
                        || String.valueOf(row.get("extension_id")).toLowerCase(Locale.ROOT).contains(normalized)
                        || String.valueOf(row.get("name")).toLowerCase(Locale.ROOT).contains(normalized)
                        || String.valueOf(row.get("description")).toLowerCase(Locale.ROOT).contains(normalized))
                .map(row -> card(actor, row))
                .toList();
        return PageResult.of(items, page, pageSize);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> communityDetail(CurrentUser actor, String extensionId) {
        Map<String, Object> row = requireByExtensionId(extensionId);
        if (!visibilityPolicy.isVisible(actor, row)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "该扩展不可见或不存在");
        }
        return detail(actor, row, false);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> communityVersions(CurrentUser actor, String extensionId) {
        Map<String, Object> row = requireByExtensionId(extensionId);
        if (!visibilityPolicy.isVisible(actor, row)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "该扩展不可见或不存在");
        }
        return versionRows((UUID) row.get("id"));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> mcpDefinition(CurrentUser actor, String extensionId) {
        Map<String, Object> extension = requireAuthorizedPublished(actor, extensionId, ExtensionType.MCP_SERVER);
        List<Map<String, Object>> definitions = jdbc.queryForList("""
                select access_type, transport, config_schema::text as config_schema
                from mcp_definitions where extension_pk = ?
                """, extension.get("id"));
        if (definitions.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "MCP 定义不存在");
        }
        Map<String, Object> definition = definitions.get(0);
        Map<String, Object> schema = json.readMap((String) definition.get("config_schema"));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("extensionId", extension.get("extension_id"));
        response.put("version", extension.get("current_version"));
        response.put("accessType", definition.get("access_type"));
        response.put("transport", definition.get("transport"));
        response.put("endpointTemplate", schema.get("endpointTemplate"));
        response.put("variablesSchema", schema.getOrDefault("variablesSchema", List.of()));
        response.put("configTemplate", schema.getOrDefault("configTemplate", Map.of()));
        response.put("connectionTest", schema.get("connectionTest"));
        return response;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> pluginDefinition(CurrentUser actor, String extensionId) {
        Map<String, Object> extension = requireAuthorizedPublished(actor, extensionId, ExtensionType.PLUGIN);
        List<Map<String, Object>> definitions = jdbc.queryForList("""
                select install_mode, target_tools::text as target_tools, manifest::text as manifest
                from plugin_definitions where extension_pk = ?
                """, extension.get("id"));
        if (definitions.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "Plugin 定义不存在");
        }
        Map<String, Object> definition = definitions.get(0);
        Map<String, Object> manifest = json.readMap((String) definition.get("manifest"));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("extensionId", extension.get("extension_id"));
        response.put("version", extension.get("current_version"));
        response.put("installMode", definition.get("install_mode"));
        response.put("targetTools", json.read((String) definition.get("target_tools")));
        response.put("manifest", manifest);
        response.put("manualInstallDoc", manifest.get("manualInstallDoc"));
        response.put("manualUninstallDoc", manifest.get("manualUninstallDoc"));
        response.put("externalDownload", manifest.get("externalDownload"));
        response.put("requiresDownloadTicketPurpose",
                "MANUAL_DOWNLOAD".equals(definition.get("install_mode")) ? "MANUAL_DOWNLOAD" : "INSTALL");
        return response;
    }

    @Transactional
    public Map<String, Object> setStar(CurrentUser actor, String extensionId, boolean starred) {
        Map<String, Object> row = requireByExtensionId(extensionId);
        if (!visibilityPolicy.isVisible(actor, row)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "该扩展不可见或不存在");
        }
        jdbc.update("""
                insert into stars (id, user_id, extension_pk, starred, created_at, updated_at)
                values (?, ?, ?, ?, now(), now())
                on conflict (user_id, extension_pk) do update set starred = excluded.starred, updated_at = now()
                """, UUID.randomUUID(), actor.id(), row.get("id"), starred);
        return Map.of("extensionId", extensionId, "starred", starred, "starCount", starCount((UUID) row.get("id")));
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> adminList(CurrentUser actor, String keyword, ExtensionType type,
            ExtensionStatus status, VisibilityMode visibilityMode, UUID ownerDepartmentId, boolean includeChildren,
            UUID maintainerId, String riskLevel, int page, int pageSize) {
        requireAdmin(actor);
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        String normalizedRiskLevel = riskLevel == null ? "" : riskLevel.trim();
        int safePage = Math.max(page, 1);
        int safePageSize = Math.min(Math.max(pageSize, 1), 100);
        AdminListQuery query = adminListQuery(actor, normalized, type, status, visibilityMode, ownerDepartmentId,
                includeChildren, maintainerId, normalizedRiskLevel);
        long total = countLong(adminListCountSql(query.whereClause()), query.params().toArray());
        List<Object> pageParams = new ArrayList<>(query.params());
        pageParams.add(safePageSize);
        pageParams.add((safePage - 1) * safePageSize);
        List<Map<String, Object>> pageRows = jdbc.queryForList(adminListRowsSql(query.whereClause()), pageParams.toArray());
        Map<UUID, Map<String, Object>> metricsByExtension = listMetricsSummaries(pageRows);
        List<Map<String, Object>> items = pageRows.stream()
                .map(row -> adminListDetail(actor, row, metricsByExtension.get((UUID) row.get("id"))))
                .toList();
        return new PageResult<>(items, safePage, safePageSize, total, (long) safePage * safePageSize < total);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> adminDetail(CurrentUser actor, String extensionId) {
        Map<String, Object> row = requireByExtensionId(extensionId);
        requireManageExtension(actor, row);
        Map<String, Object> detail = detail(actor, row, true);
        UUID extensionPk = (UUID) row.get("id");
        detail.put("scope", scopeSummary(extensionPk));
        detail.put("authorizedScope", detail.get("scope"));
        detail.put("reviewHistory", reviewHistory(extensionId));
        detail.put("aiPrecheckHistory", aiPrecheckHistory(extensionId));
        detail.put("recentAudits", recentAudits(extensionPk, extensionId));
        detail.put("audit", Map.of("objectType", "extension", "objectId", extensionPk,
                "objectNameSnapshot", extensionId, "actions", List.of("extension.delist",
                        "extension.security_delist", "extension.relist", "extension.archive",
                        "extension.scope.reduce", "extension.visibility.reduce", "extension.ownership.transfer")));
        detail.put("localEvents", recentLocalEvents(extensionPk));
        detail.put("ownershipHistory", ownershipHistory(extensionPk));
        return detail;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> adminVersions(CurrentUser actor, String extensionId) {
        Map<String, Object> row = requireByExtensionId(extensionId);
        requireManageExtension(actor, row);
        return versionRows((UUID) row.get("id"));
    }

    private List<Map<String, Object>> rows(String whereClause) {
        return jdbc.queryForList("""
                select e.*, e.tags::text as tags_json,
                  od.name as owner_department_name, od.status as owner_department_status,
                  maintainer.name as maintainer_name, author.name as author_name,
                  coalesce((select count(*) from stars s where s.extension_pk = e.id and s.starred = true), 0) as star_count
                from extensions e
                left join departments od on od.id = e.owner_department_id
                left join users maintainer on maintainer.id = e.maintainer_id
                left join users author on author.id = e.author_id
                """ + whereClause + " order by e.created_at desc");
    }

    private String adminListRowsSql(String whereClause) {
        return """
                select e.*, e.tags::text as tags_json,
                  od.name as owner_department_name, od.status as owner_department_status,
                  maintainer.name as maintainer_name, author.name as author_name,
                  coalesce((select count(*) from stars s where s.extension_pk = e.id and s.starred = true), 0) as star_count
                from extensions e
                left join departments od on od.id = e.owner_department_id
                left join users maintainer on maintainer.id = e.maintainer_id
                left join users author on author.id = e.author_id
                """ + whereClause + " order by e.created_at desc limit ? offset ?";
    }

    private String adminListCountSql(String whereClause) {
        return """
                select count(*)
                from extensions e
                left join departments od on od.id = e.owner_department_id
                left join users maintainer on maintainer.id = e.maintainer_id
                left join users author on author.id = e.author_id
                """ + whereClause;
    }

    private AdminListQuery adminListQuery(CurrentUser actor, String normalized, ExtensionType type,
            ExtensionStatus status, VisibilityMode visibilityMode, UUID ownerDepartmentId, boolean includeChildren,
            UUID maintainerId, String normalizedRiskLevel) {
        List<String> clauses = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (!actor.isSystemAdmin()) {
            if (!actor.isDepartmentAdmin()) {
                clauses.add("1 = 0");
            } else {
                addUuidInClause(clauses, params, "e.owner_department_id",
                        new ArrayList<>(departmentTreeService.selfAndDescendantIds(actor.departmentId(), true)));
            }
        }
        if (type != null) {
            clauses.add("e.type = ?");
            params.add(type.name());
        }
        if (status != null) {
            clauses.add("e.status = ?");
            params.add(status.name());
        }
        if (visibilityMode != null) {
            clauses.add("e.visibility_mode = ?");
            params.add(visibilityMode.name());
        }
        if (ownerDepartmentId != null) {
            List<UUID> ownerIds = includeChildren
                    ? new ArrayList<>(departmentTreeService.selfAndDescendantIds(ownerDepartmentId, true))
                    : List.of(ownerDepartmentId);
            addUuidInClause(clauses, params, "e.owner_department_id", ownerIds);
        }
        if (maintainerId != null) {
            clauses.add("e.maintainer_id = ?");
            params.add(maintainerId);
        }
        if (StringUtils.hasText(normalizedRiskLevel)) {
            clauses.add("lower(coalesce(e.risk_level, '')) = lower(?)");
            params.add(normalizedRiskLevel);
        }
        if (StringUtils.hasText(normalized)) {
            String like = "%" + normalized + "%";
            clauses.add("""
                    (lower(e.extension_id) like ?
                     or lower(e.name) like ?
                     or lower(coalesce(author.name, '')) like ?
                     or lower(coalesce(maintainer.name, '')) like ?
                     or lower(coalesce(od.name, '')) like ?)
                    """);
            params.add(like);
            params.add(like);
            params.add(like);
            params.add(like);
            params.add(like);
        }
        return new AdminListQuery(clauses.isEmpty() ? "" : " where " + String.join(" and ", clauses), params);
    }

    private void addUuidInClause(List<String> clauses, List<Object> params, String column, List<UUID> values) {
        if (values.isEmpty()) {
            clauses.add("1 = 0");
            return;
        }
        clauses.add(column + " in (" + placeholders(values.size()) + ")");
        params.addAll(values);
    }

    private Map<String, Object> requireByExtensionId(String extensionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select e.*, e.tags::text as tags_json,
                  od.name as owner_department_name, od.status as owner_department_status,
                  maintainer.name as maintainer_name, author.name as author_name,
                  coalesce((select count(*) from stars s where s.extension_pk = e.id and s.starred = true), 0) as star_count
                from extensions e
                left join departments od on od.id = e.owner_department_id
                left join users maintainer on maintainer.id = e.maintainer_id
                left join users author on author.id = e.author_id
                where e.extension_id = ?
                """, extensionId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "扩展不存在");
        }
        return rows.get(0);
    }

    private Map<String, Object> requireAuthorizedPublished(CurrentUser actor, String extensionId, ExtensionType type) {
        Map<String, Object> row = requireByExtensionId(extensionId);
        if (!type.name().equals(row.get("type")) || !"PUBLISHED".equals(row.get("status"))) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "扩展定义不存在");
        }
        if (!visibilityPolicy.isVisible(actor, row)) {
            throw new BusinessException(ErrorCode.SCOPE_RESTRICTED, "授权范围不允许访问该扩展定义");
        }
        if (!visibilityPolicy.isMainOperationAllowed(actor, row)) {
            throw new BusinessException(ErrorCode.SCOPE_RESTRICTED, "授权范围不允许访问该扩展定义");
        }
        return row;
    }

    private Map<String, Object> card(CurrentUser actor, Map<String, Object> row) {
        Map<String, Object> card = new LinkedHashMap<>();
        UUID extensionPk = (UUID) row.get("id");
        card.put("id", extensionPk);
        card.put("extensionId", row.get("extension_id"));
        card.put("type", row.get("type"));
        card.put("name", row.get("name"));
        card.put("description", row.get("description"));
        card.put("category", row.get("category"));
        card.put("tags", json.read((String) row.get("tags_json")));
        card.put("visibilityMode", row.get("visibility_mode"));
        card.put("status", row.get("status"));
        card.put("currentVersion", row.get("current_version"));
        card.put("starCount", ((Number) row.get("star_count")).longValue());
        card.put("starred", isStarred(actor.id(), extensionPk));
        boolean mainOperationAllowed = visibilityPolicy.isMainOperationAllowed(actor, row);
        card.put("authorized", mainOperationAllowed);
        card.put("mainOperationDeniedReason", mainOperationAllowed ? null : "scope_restricted");
        return card;
    }

    private Map<String, Object> detail(CurrentUser actor, Map<String, Object> row, boolean admin) {
        Map<String, Object> detail = new LinkedHashMap<>(card(actor, row));
        detail.put("ownerDepartmentId", row.get("owner_department_id"));
        detail.put("maintainerId", row.get("maintainer_id"));
        detail.put("authorId", row.get("author_id"));
        detail.put("riskLevel", row.get("risk_level"));
        detail.put("riskSummary", row.get("risk_summary"));
        detail.put("updatedAt", row.get("updated_at"));
        detail.put("createdAt", row.get("created_at"));
        if (admin) {
            detail.put("authorName", row.get("author_name"));
            detail.put("authorSnapshot", compactMap("id", row.get("author_id"), "name", row.get("author_name")));
            detail.put("maintainerName", row.get("maintainer_name"));
            detail.put("maintainer", compactMap("id", row.get("maintainer_id"), "name", row.get("maintainer_name")));
            detail.put("ownerDepartmentName", row.get("owner_department_name"));
            detail.put("ownerDepartment", compactMap("id", row.get("owner_department_id"), "name",
                    row.get("owner_department_name"), "status", row.get("owner_department_status")));
            detail.put("metrics", metricsSummary((UUID) row.get("id"), ((Number) row.get("star_count")).longValue()));
            detail.put("governance", Map.of("adminVisible", true, "route", "/api/admin/extensions"));
        }
        return detail;
    }

    private Map<String, Object> adminListDetail(CurrentUser actor, Map<String, Object> row,
            Map<String, Object> metrics) {
        Map<String, Object> detail = new LinkedHashMap<>(detail(actor, row, false));
        detail.put("authorName", row.get("author_name"));
        detail.put("authorSnapshot", compactMap("id", row.get("author_id"), "name", row.get("author_name")));
        detail.put("maintainerName", row.get("maintainer_name"));
        detail.put("maintainer", compactMap("id", row.get("maintainer_id"), "name", row.get("maintainer_name")));
        detail.put("ownerDepartmentName", row.get("owner_department_name"));
        detail.put("ownerDepartment", compactMap("id", row.get("owner_department_id"), "name",
                row.get("owner_department_name"), "status", row.get("owner_department_status")));
        detail.put("metrics", metrics == null ? Map.of() : metrics);
        detail.put("governance", Map.of("adminVisible", true, "route", "/api/admin/extensions"));
        return detail;
    }

    private List<Map<String, Object>> versionRows(UUID extensionPk) {
        return jdbc.queryForList("""
                select id, version, status, changelog, created_at, published_at,
                       payload_snapshot::text as payload_snapshot,
                       package_snapshot::text as package_snapshot
                from extension_versions where extension_pk = ? order by created_at desc
                """, extensionPk).stream().map(row -> {
                    Map<String, Object> item = new LinkedHashMap<>(row);
                    item.put("payloadSnapshot", json.read((String) row.get("payload_snapshot")));
                    item.put("packageSnapshot", json.read((String) row.get("package_snapshot")));
                    item.remove("payload_snapshot");
                    item.remove("package_snapshot");
                    return item;
                }).toList();
    }

    private Map<String, Object> scopeSummary(UUID extensionPk) {
        var scopes = jdbc.queryForList("""
                select id, scope_type, created_at
                from extension_authorization_scopes
                where extension_pk = ?
                order by created_at desc
                limit 1
                """, extensionPk);
        if (scopes.isEmpty()) {
            return Map.of();
        }
        Map<String, Object> scope = new LinkedHashMap<>();
        Map<String, Object> row = scopes.get(0);
        UUID scopeId = (UUID) row.get("id");
        scope.put("scopeId", scopeId);
        scope.put("scopeType", row.get("scope_type"));
        scope.put("createdAt", row.get("created_at"));
        scope.put("departments", jdbc.queryForList("""
                select ead.department_id, ead.include_children, d.name as department_name, d.status as department_status
                from extension_authorized_departments ead
                left join departments d on d.id = ead.department_id
                where ead.scope_id = ?
                order by d.name nulls last
                """, scopeId).stream()
                .map(department -> compactMap("departmentId", department.get("department_id"),
                        "departmentName", department.get("department_name"),
                        "includeChildren", department.get("include_children"),
                        "departmentStatus", department.get("department_status")))
                .toList());
        return scope;
    }

    private Map<String, Object> metricsSummary(UUID extensionPk, long starCount) {
        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("stars", starCount);
        metrics.put("downloads", countLong("""
                select count(distinct user_id) from activity_events
                where extension_pk = ? and event_type = 'DOWNLOAD_STARTED'
                """, extensionPk));
        metrics.put("weeklyDownloads", countLong("""
                select count(distinct user_id) from activity_events
                where extension_pk = ? and event_type = 'DOWNLOAD_STARTED'
                  and created_at >= now() - interval '7 days'
                """, extensionPk));
        metrics.put("mcpUsageUsers", countLong("""
                select count(distinct user_id) from local_events
                where extension_pk = ? and event_type = 'MCP_CONFIG_WRITE'
                  and result = 'SUCCESS'
                """, extensionPk));
        metrics.put("mcpConnectionFailures", countLong("""
                select count(*) from local_events
                where extension_pk = ? and event_type = 'MCP_CONNECTION_TEST'
                  and result is not null and result <> 'SUCCESS'
                """, extensionPk));
        metrics.put("pluginInstallUsers", countLong("""
                select count(distinct user_id) from local_events
                where extension_pk = ? and event_type in ('PLUGIN_INSTALL', 'PLUGIN_MANUAL_MARK_INSTALLED')
                  and result = 'SUCCESS'
                """, extensionPk));
        metrics.put("pluginUninstallFailures", countLong("""
                select count(*) from local_events
                where extension_pk = ? and event_type in ('PLUGIN_UNINSTALL', 'PLUGIN_MANUAL_MARK_UNINSTALLED')
                  and result is not null and result <> 'SUCCESS'
                """, extensionPk));
        metrics.put("localEventFailures", countLong("""
                select count(*) from local_events
                where extension_pk = ? and result is not null and result <> 'SUCCESS'
                """, extensionPk));
        metrics.put("activeUsers", countLong("""
                select count(distinct user_id) from local_events
                where extension_pk = ?
                """, extensionPk));
        metrics.put("metricAggregates", jdbc.queryForList("""
                select metric_type, period, value, calculated_at
                from metric_period_aggregates
                where extension_pk = ?
                order by calculated_at desc
                limit 12
                """, extensionPk).stream()
                .map(row -> compactMap("metricType", row.get("metric_type"),
                        "period", row.get("period"),
                        "value", row.get("value"),
                        "calculatedAt", row.get("calculated_at")))
                .toList());
        return metrics;
    }

    private Map<UUID, Map<String, Object>> listMetricsSummaries(List<Map<String, Object>> rows) {
        Map<UUID, Map<String, Object>> metrics = new LinkedHashMap<>();
        List<UUID> extensionIds = rows.stream()
                .map(row -> (UUID) row.get("id"))
                .toList();
        for (Map<String, Object> row : rows) {
            UUID extensionPk = (UUID) row.get("id");
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("stars", ((Number) row.get("star_count")).longValue());
            summary.put("downloads", 0L);
            summary.put("activeUsers", 0L);
            summary.put("localEventFailures", 0L);
            metrics.put(extensionPk, summary);
        }
        if (extensionIds.isEmpty()) {
            return metrics;
        }
        String placeholders = placeholders(extensionIds.size());
        jdbc.queryForList("""
                select extension_pk, count(distinct user_id) as downloads
                from activity_events
                where event_type = 'DOWNLOAD_STARTED' and extension_pk in (
                """ + placeholders + """
                )
                group by extension_pk
                """, extensionIds.toArray()).forEach(row -> {
                    Map<String, Object> summary = metrics.get(row.get("extension_pk"));
                    if (summary != null) {
                        summary.put("downloads", numberLong(row.get("downloads")));
                    }
                });
        jdbc.queryForList("""
                select extension_pk,
                       count(distinct user_id) as active_users,
                       count(*) filter (where result is not null and result <> 'SUCCESS') as local_event_failures
                from local_events
                where extension_pk in (
                """ + placeholders + """
                )
                group by extension_pk
                """, extensionIds.toArray()).forEach(row -> {
                    Map<String, Object> summary = metrics.get(row.get("extension_pk"));
                    if (summary != null) {
                        summary.put("activeUsers", numberLong(row.get("active_users")));
                        summary.put("localEventFailures", numberLong(row.get("local_event_failures")));
                    }
                });
        return metrics;
    }

    private List<Map<String, Object>> reviewHistory(String extensionId) {
        return jdbc.queryForList("""
                select s.id, s.type, s.status, s.created_at, s.updated_at, s.decided_at,
                       u.name as submitter_name,
                       r.decision, r.comment, r.reason_codes::text as reason_codes, r.created_at as reviewed_at
                from submissions s
                join users u on u.id = s.submitter_id
                left join reviews r on r.submission_id = s.id
                where s.target_extension_id = ?
                order by coalesce(r.created_at, s.decided_at, s.updated_at, s.created_at) desc
                limit 8
                """, extensionId).stream()
                .map(row -> compactMap("submissionId", row.get("id"),
                        "type", row.get("type"),
                        "status", row.get("status"),
                        "submitterName", row.get("submitter_name"),
                        "decision", row.get("decision"),
                        "comment", row.get("comment"),
                        "reasonCodes", json.read((String) row.get("reason_codes")),
                        "createdAt", row.get("created_at"),
                        "reviewedAt", row.get("reviewed_at"),
                        "decidedAt", row.get("decided_at")))
                .toList();
    }

    private List<Map<String, Object>> aiPrecheckHistory(String extensionId) {
        return jdbc.queryForList("""
                select s.id as submission_id, sp.rule_status, sp.rule_result::text as rule_result,
                       sp.ai_status, sp.ai_result_summary::text as ai_result_summary,
                       sp.ai_model, sp.ai_prompt_version, sp.created_at
                from submissions s
                join system_prechecks sp on sp.submission_id = s.id
                where s.target_extension_id = ?
                order by sp.created_at desc
                limit 8
                """, extensionId).stream()
                .map(row -> compactMap("submissionId", row.get("submission_id"),
                        "ruleStatus", row.get("rule_status"),
                        "ruleResult", json.read((String) row.get("rule_result")),
                        "aiStatus", row.get("ai_status"),
                        "aiResultSummary", json.read((String) row.get("ai_result_summary")),
                        "aiModel", row.get("ai_model"),
                        "aiPromptVersion", row.get("ai_prompt_version"),
                        "createdAt", row.get("created_at")))
                .toList();
    }

    private List<Map<String, Object>> recentAudits(UUID extensionPk, String extensionId) {
        return jdbc.queryForList("""
                select id, request_id, actor_id, actor_snapshot::text as actor_snapshot, object_type, object_id,
                       object_name_snapshot, action, result, reason, before_summary::text as before_summary,
                       after_summary::text as after_summary, device_id, created_at
                from audit_logs
                where object_type = 'extension'
                  and (object_id = ? or object_name_snapshot = ?)
                order by created_at desc
                limit 8
                """, extensionPk.toString(), extensionId).stream()
                .map(row -> compactMap("id", row.get("id"),
                        "requestId", row.get("request_id"),
                        "actorId", row.get("actor_id"),
                        "actorSnapshot", json.read((String) row.get("actor_snapshot")),
                        "objectType", row.get("object_type"),
                        "objectId", row.get("object_id"),
                        "objectNameSnapshot", row.get("object_name_snapshot"),
                        "action", row.get("action"),
                        "result", row.get("result"),
                        "reason", row.get("reason"),
                        "beforeSummary", json.read((String) row.get("before_summary")),
                        "afterSummary", json.read((String) row.get("after_summary")),
                        "deviceId", row.get("device_id"),
                        "createdAt", row.get("created_at")))
                .toList();
    }

    private List<Map<String, Object>> recentLocalEvents(UUID extensionPk) {
        return jdbc.queryForList("""
                select device_id, event_type, result, error_code, payload_summary::text as payload_summary,
                       occurred_at, synced_at
                from local_events
                where extension_pk = ?
                order by synced_at desc
                limit 8
                """, extensionPk).stream()
                .map(row -> compactMap("deviceId", row.get("device_id"),
                        "eventType", row.get("event_type"),
                        "result", row.get("result"),
                        "errorCode", row.get("error_code"),
                        "payloadSummary", json.read((String) row.get("payload_summary")),
                        "occurredAt", row.get("occurred_at"),
                        "syncedAt", row.get("synced_at")))
                .toList();
    }

    private List<Map<String, Object>> ownershipHistory(UUID extensionPk) {
        return jdbc.queryForList("""
                select h.id, h.before_owner_department_id, before_department.name as before_owner_department_name,
                       h.after_owner_department_id, after_department.name as after_owner_department_name,
                       h.before_maintainer_id, before_maintainer.name as before_maintainer_name,
                       h.after_maintainer_id, after_maintainer.name as after_maintainer_name,
                       h.reason, h.changed_by, changed_by.name as changed_by_name, h.created_at
                from extension_ownership_history h
                left join departments before_department on before_department.id = h.before_owner_department_id
                left join departments after_department on after_department.id = h.after_owner_department_id
                left join users before_maintainer on before_maintainer.id = h.before_maintainer_id
                left join users after_maintainer on after_maintainer.id = h.after_maintainer_id
                left join users changed_by on changed_by.id = h.changed_by
                where h.extension_pk = ?
                order by h.created_at desc
                limit 8
                """, extensionPk).stream()
                .map(row -> compactMap("id", row.get("id"),
                        "beforeOwnerDepartmentId", row.get("before_owner_department_id"),
                        "beforeOwnerDepartmentName", row.get("before_owner_department_name"),
                        "afterOwnerDepartmentId", row.get("after_owner_department_id"),
                        "afterOwnerDepartmentName", row.get("after_owner_department_name"),
                        "beforeMaintainerId", row.get("before_maintainer_id"),
                        "beforeMaintainerName", row.get("before_maintainer_name"),
                        "afterMaintainerId", row.get("after_maintainer_id"),
                        "afterMaintainerName", row.get("after_maintainer_name"),
                        "reason", row.get("reason"),
                        "changedBy", row.get("changed_by"),
                        "changedByName", row.get("changed_by_name"),
                        "createdAt", row.get("created_at")))
                .toList();
    }

    private long countLong(String sql, Object... params) {
        Long count = jdbc.queryForObject(sql, Long.class, params);
        return count == null ? 0L : count;
    }

    private String placeholders(int size) {
        return String.join(",", java.util.Collections.nCopies(size, "?"));
    }

    private long numberLong(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private Map<String, Object> compactMap(Object... entries) {
        Map<String, Object> output = new LinkedHashMap<>();
        for (int index = 0; index + 1 < entries.length; index += 2) {
            Object value = entries[index + 1];
            if (value != null && !"".equals(value)) {
                output.put(String.valueOf(entries[index]), value);
            }
        }
        return output;
    }

    private Map<String, Object> bucket(List<Map<String, Object>> all, String type) {
        List<Map<String, Object>> typed = all.stream()
                .filter(item -> type.equals(item.get("type")))
                .sorted(Comparator.comparing(item -> -((Number) item.get("starCount")).longValue()))
                .limit(10)
                .toList();
        Map<String, Object> bucket = new LinkedHashMap<>();
        bucket.put("hot", typed);
        bucket.put("star", typed);
        bucket.put("download", List.of());
        bucket.put("usage", List.of());
        bucket.put("metric", List.of());
        return bucket;
    }

    private boolean isStarred(UUID userId, UUID extensionPk) {
        Boolean result = jdbc.queryForObject("""
                select exists(select 1 from stars where user_id = ? and extension_pk = ? and starred = true)
                """, Boolean.class, userId, extensionPk);
        return Boolean.TRUE.equals(result);
    }

    private long starCount(UUID extensionPk) {
        Long count = jdbc.queryForObject("select count(*) from stars where extension_pk = ? and starred = true",
                Long.class, extensionPk);
        return count == null ? 0 : count;
    }

    private void requireAdmin(CurrentUser actor) {
        if (!actor.isAdmin()) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权执行该操作");
        }
    }

    private void requireManageExtension(CurrentUser actor, Map<String, Object> row) {
        requireAdmin(actor);
        if (!canManageExtension(actor, row)) {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权管理该扩展");
        }
    }

    public boolean canManageExtension(CurrentUser actor, Map<String, Object> row) {
        if (actor.isSystemAdmin()) {
            return true;
        }
        if (!actor.isDepartmentAdmin()) {
            return false;
        }
        Object ownerDepartment = row.get("owner_department_id");
        return ownerDepartment instanceof UUID departmentId
                && departmentTreeService.isSelfOrDescendant(actor.departmentId(), departmentId);
    }

    private record AdminListQuery(String whereClause, List<Object> params) {
    }
}
