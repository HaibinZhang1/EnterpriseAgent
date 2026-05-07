package com.enterpriseagent.hub.organization.dto;

import java.util.UUID;

import jakarta.validation.constraints.NotBlank;

public record CreateDepartmentRequest(UUID parentId, @NotBlank String name, String reason) {
}
