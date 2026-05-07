package com.enterpriseagent.hub.auth;

import java.util.UUID;

import com.enterpriseagent.hub.organization.DepartmentStatus;

public record CurrentUser(
        UUID id,
        String name,
        String phone,
        Role role,
        UUID departmentId,
        String departmentName,
        DepartmentStatus departmentStatus,
        UUID sessionId,
        ClientType clientType,
        String deviceId,
        String clientVersion,
        String ip,
        String userAgent) {
    public boolean isSystemAdmin() { return role == Role.SYSTEM_ADMIN; }
    public boolean isDepartmentAdmin() { return role == Role.DEPARTMENT_ADMIN; }
    public boolean isAdmin() { return isSystemAdmin() || isDepartmentAdmin(); }
}
