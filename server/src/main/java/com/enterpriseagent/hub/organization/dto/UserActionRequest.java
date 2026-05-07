package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;

public record UserActionRequest(String reason, OffsetDateTime expectedUpdatedAt) {
}
