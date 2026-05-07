package com.enterpriseagent.hub.auth.dto;

import java.time.OffsetDateTime;

public record LoginResponse(String token, OffsetDateTime expiresAt, UserSummaryDto user,
        PermissionSummaryDto permissionSummary) {
}
