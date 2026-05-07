package com.enterpriseagent.hub.common.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    VALIDATION_FAILED("validation_failed", HttpStatus.BAD_REQUEST, false),
    UNAUTHENTICATED("unauthenticated", HttpStatus.UNAUTHORIZED, false),
    PERMISSION_DENIED("permission_denied", HttpStatus.FORBIDDEN, false),
    RESOURCE_NOT_FOUND("resource_not_found", HttpStatus.NOT_FOUND, false),
    STATE_CONFLICT("state_conflict", HttpStatus.CONFLICT, false),
    IDEMPOTENCY_CONFLICT("idempotency_conflict", HttpStatus.CONFLICT, false),
    SETTING_VERSION_CONFLICT("setting_version_conflict", HttpStatus.CONFLICT, false),
    ACCOUNT_LOCKED("account_locked", HttpStatus.TOO_MANY_REQUESTS, false),
    DEPARTMENT_DISABLED("department_disabled", HttpStatus.FORBIDDEN, false),
    LAST_SYSTEM_ADMIN_REQUIRED("last_system_admin_required", HttpStatus.CONFLICT, false),
    REFRESH_NOT_SUPPORTED("refresh_not_supported", HttpStatus.BAD_REQUEST, false),
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
