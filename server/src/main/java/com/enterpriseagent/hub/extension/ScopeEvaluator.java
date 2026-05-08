package com.enterpriseagent.hub.extension;

import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.organization.DepartmentStatus;
import com.enterpriseagent.hub.organization.DepartmentTreeService;

@Service
public class ScopeEvaluator {
    private final JdbcTemplate jdbc;
    private final DepartmentTreeService departmentTreeService;

    public ScopeEvaluator(JdbcTemplate jdbc, DepartmentTreeService departmentTreeService) {
        this.jdbc = jdbc;
        this.departmentTreeService = departmentTreeService;
    }

    public boolean isAuthorized(CurrentUser actor, UUID extensionPk) {
        if (actor.departmentStatus() != DepartmentStatus.ACTIVE) {
            return false;
        }
        var scopes = jdbc.queryForList("""
                select id, scope_type from extension_authorization_scopes where extension_pk = ?
                """, extensionPk);
        if (scopes.isEmpty()) {
            return false;
        }
        for (Map<String, Object> scope : scopes) {
            ScopeType type = ScopeType.valueOf(scope.get("scope_type").toString());
            if (type == ScopeType.ALL_EMPLOYEES) {
                return true;
            }
            UUID scopeId = (UUID) scope.get("id");
            var departments = jdbc.queryForList("""
                    select department_id, include_children from extension_authorized_departments where scope_id = ?
                    """, scopeId);
            for (Map<String, Object> department : departments) {
                UUID departmentId = (UUID) department.get("department_id");
                boolean includeChildren = Boolean.TRUE.equals(department.get("include_children"));
                if (type == ScopeType.DEPARTMENT && actor.departmentId().equals(departmentId)) {
                    return true;
                }
                if (type == ScopeType.DEPARTMENT_TREE
                        && departmentTreeService.isSelfOrDescendant(departmentId, actor.departmentId())) {
                    return true;
                }
                if (type == ScopeType.SELECTED_DEPARTMENTS && (actor.departmentId().equals(departmentId)
                        || (includeChildren && departmentTreeService.isSelfOrDescendant(departmentId, actor.departmentId())))) {
                    return true;
                }
            }
        }
        return false;
    }
}
