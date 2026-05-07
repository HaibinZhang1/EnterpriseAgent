package com.enterpriseagent.hub.auth;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "enterprise-agent.auth.password-policy")
public record PasswordPolicyProperties(int minLength, boolean requireLetter, boolean requireDigit,
        boolean requireSpecial, List<String> weakPasswords) {
    public PasswordPolicyProperties {
        minLength = minLength <= 0 ? 8 : minLength;
        weakPasswords = weakPasswords == null ? List.of("password", "12345678", "qwerty123") : weakPasswords;
    }
}
