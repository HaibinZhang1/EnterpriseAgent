package com.enterpriseagent.hub.submission;

import java.util.Map;

import org.springframework.stereotype.Component;

@Component
public class NoopAiPrecheckAdapter implements AiPrecheckAdapter {
    @Override
    public AiPrecheckService.Result precheck(Map<String, Object> sanitizedInput, String model, String promptVersion) {
        return new AiPrecheckService.Result("UNAVAILABLE",
                Map.of("summary", "AI 预审适配器不可用，按设置降级", "input", sanitizedInput), model, promptVersion);
    }
}
