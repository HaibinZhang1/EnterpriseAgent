package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.enterpriseagent.hub.auth.PhoneMasker;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.organization.Department;

public record UserAdminListItem(UUID id, String name, String phoneMasked, UUID departmentId, String departmentName,
        Role role, UserStatus status, OffsetDateTime lastLoginAt, long clientDeviceCount, OffsetDateTime updatedAt) {
    public static UserAdminListItem from(User user, Department department) {
        return new UserAdminListItem(user.getId(), user.getName(), PhoneMasker.mask(user.getPhone()), user.getDepartmentId(),
                department.getName(), user.getRole(), user.getStatus(), user.getLastLoginAt(), 0, user.getUpdatedAt());
    }
}
