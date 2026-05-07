package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.enterpriseagent.hub.auth.Role;

public record UpdateUserRequest(String name, String phone, UUID departmentId, Role role, OffsetDateTime expectedUpdatedAt,
        String reason) {
}
