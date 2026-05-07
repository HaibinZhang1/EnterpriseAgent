package com.enterpriseagent.hub.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record CompleteResetPasswordRequest(@NotBlank String resetToken, @NotBlank String newPassword) {
}
