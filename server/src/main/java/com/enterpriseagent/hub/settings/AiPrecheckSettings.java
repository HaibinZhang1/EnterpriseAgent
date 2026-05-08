package com.enterpriseagent.hub.settings;

public record AiPrecheckSettings(boolean enabled, int timeoutMs, String failurePolicy, String model,
        String promptVersion) {
    public static AiPrecheckSettings defaults() {
        return new AiPrecheckSettings(false, 30000, "CONTINUE_WITH_UNAVAILABLE", null, "m4-default");
    }
}
