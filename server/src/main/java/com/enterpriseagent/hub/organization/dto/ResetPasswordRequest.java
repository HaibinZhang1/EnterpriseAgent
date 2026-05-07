package com.enterpriseagent.hub.organization.dto;

public record ResetPasswordRequest(boolean mustChangePassword, String reason) {
}
