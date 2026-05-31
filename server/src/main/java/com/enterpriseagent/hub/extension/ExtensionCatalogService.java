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
            ExtensionStatus status, VisibilityMode visibilityMode, int page, int pageSize) {
        requireAdmin(actor);
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        List<Map<String, Object>> items = rows("").stream()
                .filter(row -> canManageExtension(actor, row))
                .filter(row -> type == null || type.name().equals(row.get("type")))
                .filter(row -> status == null || status.name().equals(row.get("status")))
                .filter(row -> visibilityMode == null || visibilityMode.name().equals(row.get("visibility_mode")))
                .filter(row -> !StringUtils.hasText(normalized)
                        || String.valueOf(row.get("extension_id")).toLowerCase(Locale.ROOT).contains(normalized)
                        || String.valueOf(row.get("name")).toLowerCase(Locale.ROOT).contains(normalized))
                .map(row -> detail(actor, row, true))
                .toList();
        return PageResult.of(items, page, pageSize);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> adminDetail(CurrentUser actor, String extensionId) {
        Map<String, Object> row = requireByExtensionId(extensionId);
        requireManageExtension(actor, row);
        return detail(actor, row, true);
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
                  coalesce((select count(*) from stars s where s.extension_pk = e.id and s.starred = true), 0) as star_count
                from extensions e
                """ + whereClause + " order by e.created_at desc");
    }

    private Map<String, Object> requireByExtensionId(String extensionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select e.*, e.tags::text as tags_json,
                  coalesce((select count(*) from stars s where s.extension_pk = e.id and s.starred = true), 0) as star_count
                from extensions e where e.extension_id = ?
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
        if (admin) {
            detail.put("governance", Map.of("adminVisible", true, "route", "/api/admin/extensions"));
        }
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
}
