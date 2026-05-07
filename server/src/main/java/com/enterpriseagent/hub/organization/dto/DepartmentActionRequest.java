package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;

public record DepartmentActionRequest(String reason, OffsetDateTime expectedUpdatedAt) {
}
