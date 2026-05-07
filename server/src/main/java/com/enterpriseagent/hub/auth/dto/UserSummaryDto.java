package com.enterpriseagent.hub.auth.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.enterpriseagent.hub.auth.PhoneMasker;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.organization.Department;

public record UserSummaryDto(UUID id, String name, String phoneMasked, Role role, UUID departmentId,
        String departmentName, UserStatus status, boolean mustChangePassword, OffsetDateTime updatedAt) {
    public static UserSummaryDto from(User user, Department department) {
        return new UserSummaryDto(user.getId(), user.getName(), PhoneMasker.mask(user.getPhone()), user.getRole(),
                user.getDepartmentId(), department.getName(), user.getStatus(), user.isMustChangePassword(),
                user.getUpdatedAt());
    }
}
