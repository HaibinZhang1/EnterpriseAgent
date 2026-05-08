package com.enterpriseagent.hub.common.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    VALIDATION_FAILED("validation_failed", HttpStatus.BAD_REQUEST, false),
    UNAUTHENTICATED("unauthenticated", HttpStatus.UNAUTHORIZED, false),
    PERMISSION_DENIED("permission_denied", HttpStatus.FORBIDDEN, false),
    SCOPE_RESTRICTED("scope_restricted", HttpStatus.FORBIDDEN, false),
    RESOURCE_NOT_FOUND("resource_not_found", HttpStatus.NOT_FOUND, false),
    STATE_CONFLICT("state_conflict", HttpStatus.CONFLICT, false),
    IDEMPOTENCY_CONFLICT("idempotency_conflict", HttpStatus.CONFLICT, false),
    SETTING_VERSION_CONFLICT("setting_version_conflict", HttpStatus.CONFLICT, false),
    ACCOUNT_LOCKED("account_locked", HttpStatus.TOO_MANY_REQUESTS, false),
    DEPARTMENT_DISABLED("department_disabled", HttpStatus.FORBIDDEN, false),
    LAST_SYSTEM_ADMIN_REQUIRED("last_system_admin_required", HttpStatus.CONFLICT, false),
    REFRESH_NOT_SUPPORTED("refresh_not_supported", HttpStatus.BAD_REQUEST, false),
    INTERNAL_ERROR("internal_error", HttpStatus.INTERNAL_SERVER_ERROR, true),
    SERVER_UNAVAILABLE("server_unavailable", HttpStatus.SERVICE_UNAVAILABLE, true),
    PACKAGE_TOO_LARGE("package_too_large", HttpStatus.BAD_REQUEST, false),
    PACKAGE_FILE_COUNT_EXCEEDED("package_file_count_exceeded", HttpStatus.BAD_REQUEST, false),
    PACKAGE_PATH_TRAVERSAL("package_path_traversal", HttpStatus.BAD_REQUEST, false),
    PACKAGE_UNCOMPRESSED_SIZE_EXCEEDED("package_uncompressed_size_exceeded", HttpStatus.BAD_REQUEST, false),
    PACKAGE_UNSAFE_FILE_DETECTED("package_unsafe_file_detected", HttpStatus.BAD_REQUEST, false),
    HASH_MISMATCH("hash_mismatch", HttpStatus.BAD_REQUEST, false),
    SKILL_MANIFEST_MISSING("skill_manifest_missing", HttpStatus.BAD_REQUEST, false),
    MCP_CONFIG_TEMPLATE_INVALID("mcp_config_template_invalid", HttpStatus.BAD_REQUEST, false),
    MCP_TRANSPORT_INVALID("mcp_transport_invalid", HttpStatus.BAD_REQUEST, false),
    MCP_ENDPOINT_INVALID("mcp_endpoint_invalid", HttpStatus.BAD_REQUEST, false),
    PLUGIN_MANIFEST_INVALID("plugin_manifest_invalid", HttpStatus.BAD_REQUEST, false),
    STORAGE_WRITE_FAILED("storage_write_failed", HttpStatus.INTERNAL_SERVER_ERROR, true),
    UPLOAD_EXPIRED("upload_expired", HttpStatus.GONE, false),
    UPLOAD_NOT_OWNED("upload_not_owned", HttpStatus.FORBIDDEN, false),
    UPLOAD_ALREADY_CONSUMED("upload_already_consumed", HttpStatus.CONFLICT, false),
    DOWNLOAD_TICKET_EXPIRED("download_ticket_expired", HttpStatus.GONE, false),
    DOWNLOAD_TICKET_USED("download_ticket_used", HttpStatus.CONFLICT, false),
    DOWNLOAD_PURPOSE_INVALID("download_purpose_invalid", HttpStatus.BAD_REQUEST, false),
    PLUGIN_DOWNLOAD_SOURCE_EXPIRED("plugin_download_source_expired", HttpStatus.GONE, false),
    PLUGIN_DOWNLOAD_FAILED("plugin_download_failed", HttpStatus.BAD_REQUEST, true);

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
