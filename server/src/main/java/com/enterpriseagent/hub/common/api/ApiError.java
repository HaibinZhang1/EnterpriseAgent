package com.enterpriseagent.hub.common.api;

public record ApiError(String code, String message, Object details, boolean retryable) {
}
