package com.enterpriseagent.hub.common.audit;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.common.request.RequestContext;

@Service
public class AuditService {
    private static final String MASK = "***MASKED***";
    private final AuditLogRepository repository;

    public AuditService(AuditLogRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public AuditLog record(AuditRecord record) {
        return saveSanitized(record);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public AuditLog recordFailure(AuditRecord record) {
        return saveSanitized(record);
    }

    private AuditLog saveSanitized(AuditRecord record) {
        String requestId = StringUtils.hasText(record.requestId())
                ? record.requestId()
                : RequestContext.currentRequestId().orElse("req_system");
        AuditRecord sanitized = AuditRecord.builder()
                .requestId(requestId)
                .actorId(record.actorId())
                .actorSnapshot(redact(record.actorSnapshot()))
                .actorDepartmentSnapshot(redact(record.actorDepartmentSnapshot()))
                .objectType(record.objectType())
                .objectId(record.objectId())
                .objectNameSnapshot(record.objectNameSnapshot())
                .action(record.action())
                .result(record.result())
                .reason(record.reason())
                .beforeSummary(redact(record.beforeSummary()))
                .afterSummary(redact(record.afterSummary()))
                .ip(record.ip())
                .userAgent(record.userAgent())
                .clientVersion(record.clientVersion())
                .deviceId(record.deviceId())
                .build();
        return repository.save(new AuditLog(sanitized));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> redact(Map<String, Object> input) {
        if (input == null) {
            return null;
        }
        Map<String, Object> output = new LinkedHashMap<>();
        input.forEach((key, value) -> {
            if (isSensitive(key)) {
                output.put(key, MASK);
            } else if (value instanceof Map<?, ?> nested) {
                output.put(key, redact((Map<String, Object>) nested));
            } else {
                output.put(key, value);
            }
        });
        return output;
    }

    private boolean isSensitive(String key) {
        String normalized = key.toLowerCase(Locale.ROOT);
        return normalized.contains("password")
                || normalized.contains("token")
                || normalized.contains("secret")
                || normalized.contains("credential")
                || normalized.equals("key")
                || normalized.endsWith("key");
    }
}
