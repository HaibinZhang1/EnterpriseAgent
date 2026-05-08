package com.enterpriseagent.hub.localevents;

import java.util.List;
import java.util.UUID;

public record LocalEventSyncResponse(List<LocalEventResult> results, List<ServerStateHint> serverStateHints) {
    public enum LocalEventStatus {
        ACCEPTED,
        IGNORED,
        REJECTED
    }

    public record LocalEventResult(String idempotencyKey, LocalEventStatus status, UUID serverEventId, String errorCode) {
    }

    public record ServerStateHint(String extensionId, String state, String message) {
    }
}
