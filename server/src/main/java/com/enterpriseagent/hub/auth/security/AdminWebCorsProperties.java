package com.enterpriseagent.hub.auth.security;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "enterprise-agent.admin-web-cors")
public record AdminWebCorsProperties(List<String> allowedOrigins) {
    private static final List<String> DEFAULT_ALLOWED_ORIGINS = List.of(
            "http://localhost:4173",
            "http://127.0.0.1:4173",
            "http://localhost:5173",
            "http://127.0.0.1:5173");

    public AdminWebCorsProperties {
        allowedOrigins = allowedOrigins == null || allowedOrigins.isEmpty()
                ? DEFAULT_ALLOWED_ORIGINS
                : List.copyOf(allowedOrigins);
    }
}
