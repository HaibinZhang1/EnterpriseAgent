package com.enterpriseagent.hub.extension;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class ExtensionJson {
    private final ObjectMapper objectMapper;

    public ExtensionJson(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String envelope(String source, Object data) {
        return write(envelopeMap(source, data));
    }

    public Map<String, Object> envelopeMap(String source, Object data) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schemaVersion", 1);
        envelope.put("capturedAt", OffsetDateTime.now().toString());
        envelope.put("source", source);
        envelope.put("data", data == null ? Map.of() : data);
        return envelope;
    }

    public String write(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "JSON 序列化失败");
        }
    }

    public Object read(String json) {
        if (json == null) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (JsonProcessingException exception) {
            return json;
        }
    }

    public Map<String, Object> readMap(String json) {
        if (json == null) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "JSON 解析失败");
        }
    }
}
