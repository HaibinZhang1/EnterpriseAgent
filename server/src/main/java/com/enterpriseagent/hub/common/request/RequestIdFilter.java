package com.enterpriseagent.hub.common.request;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.Locale;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    private static final String PREFIX = "req_";
    private static final char[] ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RequestIdProperties properties;

    public RequestIdFilter(RequestIdProperties properties) {
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String headerName = properties.requestIdHeader();
        String requestId = sanitize(request.getHeader(headerName));
        if (!StringUtils.hasText(requestId)) {
            requestId = generateRequestId();
        }
        RequestContext.setRequestId(requestId);
        response.setHeader(headerName, requestId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            RequestContext.clear();
        }
    }

    static String generateRequestId() {
        char[] value = new char[26];
        for (int i = 0; i < value.length; i++) {
            value[i] = ALPHABET[RANDOM.nextInt(ALPHABET.length)];
        }
        return PREFIX + new String(value);
    }

    private static String sanitize(String candidate) {
        if (!StringUtils.hasText(candidate)) {
            return null;
        }
        String trimmed = candidate.trim();
        if (trimmed.length() > 64) {
            return null;
        }
        String normalized = trimmed.toLowerCase(Locale.ROOT);
        if (!normalized.matches("[a-z0-9_.:-]{1,64}")) {
            return null;
        }
        return trimmed;
    }
}
