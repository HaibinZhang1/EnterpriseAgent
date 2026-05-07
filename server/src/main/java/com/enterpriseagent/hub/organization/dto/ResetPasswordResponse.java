package com.enterpriseagent.hub.organization.dto;

import java.time.OffsetDateTime;

public record ResetPasswordResponse(String resetToken, OffsetDateTime expiresAt, boolean mustChangePassword) {
}
