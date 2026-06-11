package com.enterpriseagent.hub.settings;

public record AiPrecheckSettings(boolean enabled, int timeoutMs, String failurePolicy, String model,
        String promptVersion, boolean valid, String errorMessage) {
    public static AiPrecheckSettings invalid(String errorMessage) {
        return new AiPrecheckSettings(true, 30000, "FAIL_CLOSED", null, "m4-default", false, errorMessage);
    }
}
