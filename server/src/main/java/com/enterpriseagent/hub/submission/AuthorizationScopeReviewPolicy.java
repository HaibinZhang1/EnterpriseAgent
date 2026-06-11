package com.enterpriseagent.hub.submission;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.extension.ScopeType;
import com.enterpriseagent.hub.organization.DepartmentTreeService;

@Service
public class AuthorizationScopeReviewPolicy {
    private final DepartmentTreeService departmentTreeService;

    public AuthorizationScopeReviewPolicy(DepartmentTreeService departmentTreeService) {
        this.departmentTreeService = departmentTreeService;
    }

    public String reviewOwnerType(Map<String, Object> authorizationScope, UUID submitterDepartmentId) {
        if (canDepartmentReviewScope(submitterDepartmentId, authorizationScope, submitterDepartmentId)) {
            return "DEPARTMENT_ADMIN";
        }
        return "SYSTEM_ADMIN";
    }

    public boolean canDepartmentReviewScope(UUID reviewerDepartmentId, Map<String, Object> authorizationScope,
            UUID defaultDepartmentId) {
        if (reviewerDepartmentId == null) {
            return false;
        }
        ScopeType scopeType = scopeType(authorizationScope);
        if (scopeType == null) {
            return false;
        }
        if (scopeType == ScopeType.ALL_EMPLOYEES) {
            return false;
        }
        List<UUID> departments = departmentIds(authorizationScope);
        if (departments == null || departments.isEmpty()) {
            return false;
        }
        return departments.stream()
                .allMatch(departmentId -> departmentTreeService.isSelfOrDescendant(reviewerDepartmentId, departmentId));
    }

    private ScopeType scopeType(Map<String, Object> authorizationScope) {
        if (authorizationScope == null || authorizationScope.get("scopeType") == null) {
            return null;
        }
        try {
            return ScopeType.valueOf(String.valueOf(authorizationScope.get("scopeType")));
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private List<UUID> departmentIds(Map<String, Object> authorizationScope) {
        Object departments = authorizationScope == null ? null : authorizationScope.get("departments");
        if (!(departments instanceof Iterable<?> iterable)) {
            return null;
        }
        List<UUID> ids = new ArrayList<>();
        for (Object item : iterable) {
            if (!(item instanceof Map<?, ?> map) || map.get("departmentId") == null) {
                return null;
            }
            try {
                ids.add(UUID.fromString(String.valueOf(map.get("departmentId"))));
            } catch (IllegalArgumentException exception) {
                return null;
            }
        }
        return ids;
    }
}
