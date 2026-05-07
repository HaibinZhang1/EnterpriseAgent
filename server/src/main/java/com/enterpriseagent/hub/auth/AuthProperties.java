package com.enterpriseagent.hub.auth;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "enterprise-agent.auth")
public record AuthProperties(
        Duration desktopSessionTtl,
        Duration adminSessionTtl,
        Duration adminIdleTtl,
        Duration loginFailureWindow,
        int maxLoginFailures,
        Duration lockDuration,
        Duration resetTokenTtl) {
    public AuthProperties {
        desktopSessionTtl = desktopSessionTtl == null ? Duration.ofDays(30) : desktopSessionTtl;
        adminSessionTtl = adminSessionTtl == null ? Duration.ofHours(8) : adminSessionTtl;
        adminIdleTtl = adminIdleTtl == null ? Duration.ofMinutes(30) : adminIdleTtl;
        loginFailureWindow = loginFailureWindow == null ? Duration.ofMinutes(15) : loginFailureWindow;
        maxLoginFailures = maxLoginFailures <= 0 ? 5 : maxLoginFailures;
        lockDuration = lockDuration == null ? Duration.ofMinutes(15) : lockDuration;
        resetTokenTtl = resetTokenTtl == null ? Duration.ofHours(1) : resetTokenTtl;
    }
}
