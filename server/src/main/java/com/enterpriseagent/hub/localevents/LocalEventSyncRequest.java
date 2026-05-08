package com.enterpriseagent.hub.localevents;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

public record LocalEventSyncRequest(String deviceId, List<LocalEventItem> events) {
    public record LocalEventItem(
            String idempotencyKey,
            String requestId,
            String extensionId,
            String version,
            String type,
            String result,
            String errorCode,
            OffsetDateTime occurredAt,
            Map<String, Object> payloadSummary) {
    }
}
