package com.enterpriseagent.hub.common.audit;

import java.util.Map;
import java.util.UUID;

public record AuditRecord(
        String requestId,
        UUID actorId,
        Map<String, Object> actorSnapshot,
        Map<String, Object> actorDepartmentSnapshot,
        String objectType,
        String objectId,
        String objectNameSnapshot,
        String action,
        AuditResult result,
        String reason,
        Map<String, Object> beforeSummary,
        Map<String, Object> afterSummary,
        String ip,
        String userAgent,
        String clientVersion,
        String deviceId) {

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String requestId;
        private UUID actorId;
        private Map<String, Object> actorSnapshot;
        private Map<String, Object> actorDepartmentSnapshot;
        private String objectType;
        private String objectId;
        private String objectNameSnapshot;
        private String action;
        private AuditResult result = AuditResult.SUCCESS;
        private String reason;
        private Map<String, Object> beforeSummary;
        private Map<String, Object> afterSummary;
        private String ip;
        private String userAgent;
        private String clientVersion;
        private String deviceId;

        public Builder requestId(String requestId) { this.requestId = requestId; return this; }
        public Builder actorId(UUID actorId) { this.actorId = actorId; return this; }
        public Builder actorSnapshot(Map<String, Object> actorSnapshot) { this.actorSnapshot = actorSnapshot; return this; }
        public Builder actorDepartmentSnapshot(Map<String, Object> actorDepartmentSnapshot) { this.actorDepartmentSnapshot = actorDepartmentSnapshot; return this; }
        public Builder objectType(String objectType) { this.objectType = objectType; return this; }
        public Builder objectId(String objectId) { this.objectId = objectId; return this; }
        public Builder objectNameSnapshot(String objectNameSnapshot) { this.objectNameSnapshot = objectNameSnapshot; return this; }
        public Builder action(String action) { this.action = action; return this; }
        public Builder result(AuditResult result) { this.result = result; return this; }
        public Builder reason(String reason) { this.reason = reason; return this; }
        public Builder beforeSummary(Map<String, Object> beforeSummary) { this.beforeSummary = beforeSummary; return this; }
        public Builder afterSummary(Map<String, Object> afterSummary) { this.afterSummary = afterSummary; return this; }
        public Builder ip(String ip) { this.ip = ip; return this; }
        public Builder userAgent(String userAgent) { this.userAgent = userAgent; return this; }
        public Builder clientVersion(String clientVersion) { this.clientVersion = clientVersion; return this; }
        public Builder deviceId(String deviceId) { this.deviceId = deviceId; return this; }

        public AuditRecord build() {
            return new AuditRecord(requestId, actorId, actorSnapshot, actorDepartmentSnapshot, objectType, objectId,
                    objectNameSnapshot, action, result, reason, beforeSummary, afterSummary, ip, userAgent,
                    clientVersion, deviceId);
        }
    }
}
