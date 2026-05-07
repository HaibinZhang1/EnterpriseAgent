package com.enterpriseagent.hub.organization.dto;

import java.util.UUID;

import com.enterpriseagent.hub.auth.Role;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateUserRequest(@NotBlank String name, @NotBlank String phone, @NotNull UUID departmentId,
        @NotNull Role role, @NotBlank String initialPassword, boolean mustChangePassword, String reason) {
}
