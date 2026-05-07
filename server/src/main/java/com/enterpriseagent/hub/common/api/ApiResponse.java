package com.enterpriseagent.hub.common.api;

import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.common.request.RequestContext;

public record ApiResponse<T>(String requestId, boolean success, T data, ApiError error) {

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(RequestContext.requireRequestId(), true, data, null);
    }

    public static <T> ApiResponse<T> error(ErrorCode errorCode, String message, Object details) {
        return error(errorCode.code(), message, details, errorCode.retryable());
    }

    public static <T> ApiResponse<T> error(String code, String message, Object details, boolean retryable) {
        return new ApiResponse<>(RequestContext.requireRequestId(), false, null,
                new ApiError(code, message, details, retryable));
    }
}
