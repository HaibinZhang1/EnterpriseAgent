package com.enterpriseagent.hub.common.idempotency;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

@Service
public class IdempotencyService {
    private static final int MAX_KEY_LENGTH = 128;
    private static final Duration RECORD_TTL = Duration.ofHours(24);

    private final IdempotencyRecordRepository repository;
    private final ObjectMapper objectMapper;
    private final ObjectMapper hashingMapper;

    public IdempotencyService(IdempotencyRecordRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.hashingMapper = objectMapper.copy().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
    }

    @Transactional
    public <T> T execute(CurrentUser actor, String operation, String idempotencyKey, Object request,
            Class<T> responseType, Supplier<T> action) {
        validateKey(idempotencyKey);
        String requestHash = requestHash(operation, request);
        var existing = repository.findByActorIdAndOperationAndIdempotencyKey(actor.id(), operation, idempotencyKey);
        if (existing.isPresent()) {
            return replay(existing.get(), requestHash, responseType);
        }

        IdempotencyRecord record = new IdempotencyRecord(actor.id(), operation, idempotencyKey, requestHash,
                OffsetDateTime.now().plus(RECORD_TTL));
        repository.saveAndFlush(record);
        T result = action.get();
        record.markSucceeded(snapshot(result));
        return result;
    }

    private <T> T replay(IdempotencyRecord record, String requestHash, Class<T> responseType) {
        if (!record.getRequestHash().equals(requestHash)) {
            throw new BusinessException(ErrorCode.IDEMPOTENCY_CONFLICT, "同一个 Idempotency-Key 不能用于不同请求");
        }
        if (record.getStatus() != IdempotencyStatus.SUCCEEDED) {
            throw new BusinessException(ErrorCode.IDEMPOTENCY_CONFLICT, "幂等请求正在处理");
        }
        if (responseType == Void.class || record.getResponseSnapshot() == null) {
            return null;
        }
        return objectMapper.convertValue(record.getResponseSnapshot(), responseType);
    }

    private void validateKey(String idempotencyKey) {
        if (!StringUtils.hasText(idempotencyKey)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "管理端写操作必须携带 Idempotency-Key");
        }
        if (idempotencyKey.length() > MAX_KEY_LENGTH) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "Idempotency-Key 过长");
        }
    }

    private String requestHash(String operation, Object request) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("operation", operation);
            payload.put("request", request);
            byte[] bytes = hashingMapper.writeValueAsBytes(payload);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (JsonProcessingException | NoSuchAlgorithmException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "幂等请求摘要生成失败");
        }
    }

    private Map<String, Object> snapshot(Object result) {
        if (result == null) {
            return null;
        }
        return objectMapper.convertValue(result, new TypeReference<Map<String, Object>>() {
        });
    }
}
