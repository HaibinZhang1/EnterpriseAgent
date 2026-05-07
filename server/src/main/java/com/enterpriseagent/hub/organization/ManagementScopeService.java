package com.enterpriseagent.hub.organization;

import java.util.UUID;

import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;

@Service
public class ManagementScopeService {
    private final DepartmentTreeService departmentTreeService;

    public ManagementScopeService(DepartmentTreeService departmentTreeService) {
        this.departmentTreeService = departmentTreeService;
    }

    public boolean canManageDepartment(CurrentUser actor, UUID targetDepartmentId) {
        if (actor.isSystemAdmin()) return true;
        if (!actor.isDepartmentAdmin()) return false;
        return departmentTreeService.isStrictDescendant(actor.departmentId(), targetDepartmentId);
    }

    public boolean canViewDepartment(CurrentUser actor, UUID targetDepartmentId) {
        if (actor.isSystemAdmin()) return true;
        if (!actor.isDepartmentAdmin()) return false;
        return departmentTreeService.isSelfOrDescendant(actor.departmentId(), targetDepartmentId);
    }

    public boolean canCreateDepartment(CurrentUser actor, UUID parentDepartmentId) {
        if (actor.isSystemAdmin()) return true;
        if (!actor.isDepartmentAdmin() || parentDepartmentId == null) return false;
        return departmentTreeService.isSelfOrDescendant(actor.departmentId(), parentDepartmentId);
    }

    public boolean canManageUser(CurrentUser actor, User target) {
        if (actor.isSystemAdmin()) return true;
        if (!actor.isDepartmentAdmin()) return false;
        if (target.getId().equals(actor.id())) return false;
        if (target.getRole() == Role.SYSTEM_ADMIN) return false;
        if (!departmentTreeService.isSelfOrDescendant(actor.departmentId(), target.getDepartmentId())) return false;
        if (target.getRole() == Role.DEPARTMENT_ADMIN) {
            return departmentTreeService.isStrictDescendant(actor.departmentId(), target.getDepartmentId());
        }
        return true;
    }

    public boolean canAssign(CurrentUser actor, Role targetRole, UUID targetDepartmentId) {
        if (actor.isSystemAdmin()) return true;
        if (!actor.isDepartmentAdmin()) return false;
        if (targetRole == Role.SYSTEM_ADMIN) return false;
        if (targetRole == Role.DEPARTMENT_ADMIN) {
            return departmentTreeService.isStrictDescendant(actor.departmentId(), targetDepartmentId);
        }
        return departmentTreeService.isSelfOrDescendant(actor.departmentId(), targetDepartmentId);
    }
}
