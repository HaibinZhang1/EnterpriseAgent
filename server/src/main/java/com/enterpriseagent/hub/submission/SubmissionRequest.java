package com.enterpriseagent.hub.submission;

import java.util.List;
import java.util.Map;

import com.enterpriseagent.hub.extension.ExtensionType;
import com.enterpriseagent.hub.extension.VisibilityMode;

public record SubmissionRequest(
        SubmissionType type,
        ExtensionType extensionType,
        String extensionId,
        String baseExtensionId,
        String version,
        Map<String, Object> metadata,
        Map<String, Object> authorizationScope,
        VisibilityMode visibilityMode,
        Map<String, Object> riskStatement,
        Map<String, Object> typePayload,
        List<Map<String, Object>> uploadRefs) {
}
