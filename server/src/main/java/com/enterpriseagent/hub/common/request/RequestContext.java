package com.enterpriseagent.hub.common.request;

import java.util.Optional;

import org.slf4j.MDC;

public final class RequestContext {
    public static final String DEFAULT_REQUEST_ID_HEADER = "X-Request-ID";
    public static final String MDC_REQUEST_ID_KEY = "requestId";
    private static final ThreadLocal<String> REQUEST_ID = new ThreadLocal<>();

    private RequestContext() {
    }

    public static void setRequestId(String requestId) {
        REQUEST_ID.set(requestId);
        MDC.put(MDC_REQUEST_ID_KEY, requestId);
    }

    public static Optional<String> currentRequestId() {
        return Optional.ofNullable(REQUEST_ID.get());
    }

    public static String requireRequestId() {
        return currentRequestId().orElse("req_unknown");
    }

    public static void clear() {
        REQUEST_ID.remove();
        MDC.remove(MDC_REQUEST_ID_KEY);
    }
}
