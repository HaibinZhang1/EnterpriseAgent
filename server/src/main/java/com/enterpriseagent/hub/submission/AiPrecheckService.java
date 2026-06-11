package com.enterpriseagent.hub.submission;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.settings.SettingsQueryService;

@Service
public class AiPrecheckService {
    private final SettingsQueryService settingsQueryService;
    private final AiPrecheckAdapter adapter;

    public AiPrecheckService(SettingsQueryService settingsQueryService, AiPrecheckAdapter adapter) {
        this.settingsQueryService = settingsQueryService;
        this.adapter = adapter;
    }

    public Result precheck(SubmissionRequest request) {
        var settings = settingsQueryService.aiPrecheckSettings();
        if (!settings.valid()) {
            return unavailableOrFail(settings, Map.of("summary", "AI 预审配置错误", "error", settings.errorMessage()));
        }
        if (!settings.enabled()) {
            return new Result("DISABLED", Map.of("summary", "AI 预审未启用", "promptVersion", settings.promptVersion()),
                    settings.model(), settings.promptVersion());
        }
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("extensionType", request.extensionType().name());
        input.put("extensionId", request.extensionId());
        input.put("metadata", request.metadata() == null ? Map.of() : request.metadata());
        input.put("authorizationScope", request.authorizationScope() == null ? Map.of() : request.authorizationScope());
        input.put("visibilityMode", request.visibilityMode() == null ? null : request.visibilityMode().name());
        input.put("riskStatement", request.riskStatement() == null ? Map.of() : request.riskStatement());
        input.put("typePayload", request.typePayload() == null ? Map.of() : request.typePayload());
        Map<String, Object> sanitized = redact(input);
        Result result;
        try {
            result = adapter.precheck(sanitized, settings.model(), settings.promptVersion());
        } catch (RuntimeException exception) {
            result = new Result("UNAVAILABLE", Map.of("summary", "AI 预审适配器异常", "error", String.valueOf(exception.getMessage())),
                    settings.model(), settings.promptVersion());
        }
        if ("UNAVAILABLE".equalsIgnoreCase(result.status())) {
            return unavailableOrFail(settings, result.summary());
        }
        return result;
    }

    public record Result(String status, Map<String, Object> summary, String model, String promptVersion) {
    }

    private Map<String, Object> redact(Map<String, Object> input) {
        Map<String, Object> output = new LinkedHashMap<>();
        input.forEach((key, value) -> {
            String normalized = key.toLowerCase(Locale.ROOT);
            if (normalized.contains("password") || normalized.contains("token") || normalized.contains("secret")
                    || normalized.contains("credential") || normalized.endsWith("key")) {
                output.put(key, "***MASKED***");
            } else {
                output.put(key, redactValue(value));
            }
        });
        return output;
    }

    private Result unavailableOrFail(com.enterpriseagent.hub.settings.AiPrecheckSettings settings,
            Map<String, Object> summary) {
        if ("FAIL_CLOSED".equals(settings.failurePolicy())) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "AI 预审不可用，已按 FAIL_CLOSED 阻断发布");
        }
        return new Result("UNAVAILABLE", summary, settings.model(), settings.promptVersion());
    }

    private Object redactValue(Object value) {
        if (value instanceof Map<?, ?> nested) {
            return redact(toStringKeyMap(nested));
        }
        if (value instanceof Iterable<?> iterable) {
            List<Object> redacted = new ArrayList<>();
            for (Object item : iterable) {
                redacted.add(redactValue(item));
            }
            return redacted;
        }
        return value;
    }

    private Map<String, Object> toStringKeyMap(Map<?, ?> input) {
        Map<String, Object> output = new LinkedHashMap<>();
        input.forEach((key, value) -> output.put(String.valueOf(key), value));
        return output;
    }
}
