package com.enterpriseagent.hub.auth.dto;

import com.enterpriseagent.hub.auth.ClientType;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(@NotBlank String phone, @NotBlank String password, ClientType clientType, String deviceId,
        String clientVersion) {
}
