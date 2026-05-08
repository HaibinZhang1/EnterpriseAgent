package com.enterpriseagent.hub.extension;

import java.util.Map;
import java.util.UUID;

public record ExtensionGovernanceRequest(
        String reason,
        String reasonType,
        String reasonDetail,
        String securityReason,
        String impactSummary,
        String handlingAdvice,
        String targetVisibilityMode,
        Map<String, Object> targetScope,
        UUID targetOwnerDepartmentId,
        UUID targetMaintainerId) {
}
