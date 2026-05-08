package com.enterpriseagent.hub.submission;

import java.util.Map;

public interface AiPrecheckAdapter {
    AiPrecheckService.Result precheck(Map<String, Object> sanitizedInput, String model, String promptVersion);
}
