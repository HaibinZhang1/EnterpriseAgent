package com.enterpriseagent.hub.organization.dto;

import java.util.List;
import java.util.UUID;

import com.enterpriseagent.hub.organization.DepartmentStatus;

public record DepartmentTreeDto(UUID id, String name, UUID parentId, DepartmentStatus status, List<String> path,
        long userCount, long activeUserCount, long departmentAdminCount, long activeExtensionCount,
        List<DepartmentTreeDto> children) {
}
