package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.enterpriseagent.hub.organization.Department;
import com.enterpriseagent.hub.organization.DepartmentStatus;

public record DepartmentDto(UUID id, String name, UUID parentId, DepartmentStatus status, OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {
    public static DepartmentDto from(Department department) {
        return new DepartmentDto(department.getId(), department.getName(), department.getParentId(), department.getStatus(),
                department.getCreatedAt(), department.getUpdatedAt());
    }
}
