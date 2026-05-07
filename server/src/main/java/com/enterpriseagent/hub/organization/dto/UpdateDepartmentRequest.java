package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;

import jakarta.validation.constraints.NotBlank;

public record UpdateDepartmentRequest(@NotBlank String name, OffsetDateTime expectedUpdatedAt, String reason) {
}
