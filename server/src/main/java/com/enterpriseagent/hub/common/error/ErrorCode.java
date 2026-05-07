package com.enterpriseagent.hub.common.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    VALIDATION_FAILED("validation_failed", HttpStatus.BAD_REQUEST, false),
    RESOURCE_NOT_FOUND("resource_not_found", HttpStatus.NOT_FOUND, false),
    STATE_CONFLICT("state_conflict", HttpStatus.CONFLICT, false),
    SETTING_VERSION_CONFLICT("setting_version_conflict", HttpStatus.CONFLICT, false),
    INTERNAL_ERROR("internal_error", HttpStatus.INTERNAL_SERVER_ERROR, true),
    SERVER_UNAVAILABLE("server_unavailable", HttpStatus.SERVICE_UNAVAILABLE, true);

    private final String code;
    private final HttpStatus httpStatus;
    private final boolean retryable;

    ErrorCode(String code, HttpStatus httpStatus, boolean retryable) {
        this.code = code;
        this.httpStatus = httpStatus;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public HttpStatus httpStatus() {
        return httpStatus;
    }

    public boolean retryable() {
        return retryable;
    }
}
