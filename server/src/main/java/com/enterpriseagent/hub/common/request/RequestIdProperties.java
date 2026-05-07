package com.enterpriseagent.hub.common.request;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "enterprise-agent")
public record RequestIdProperties(String requestIdHeader) {

    public RequestIdProperties {
        if (requestIdHeader == null || requestIdHeader.isBlank()) {
            requestIdHeader = RequestContext.DEFAULT_REQUEST_ID_HEADER;
        }
    }
}
