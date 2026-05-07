package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.enterpriseagent.hub.auth.PhoneMasker;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.organization.Department;

public record UserAdminDetailDto(UUID id, String name, String phoneMasked, UUID departmentId, String departmentName,
        Role role, UserStatus status, boolean mustChangePassword, OffsetDateTime lastLoginAt,
        OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    public static UserAdminDetailDto from(User user, Department department) {
        return new UserAdminDetailDto(user.getId(), user.getName(), PhoneMasker.mask(user.getPhone()), user.getDepartmentId(),
                department.getName(), user.getRole(), user.getStatus(), user.isMustChangePassword(), user.getLastLoginAt(),
                user.getCreatedAt(), user.getUpdatedAt());
    }
}
