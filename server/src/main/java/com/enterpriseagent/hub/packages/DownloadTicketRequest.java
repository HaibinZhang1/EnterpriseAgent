package com.enterpriseagent.hub.packages;

import java.util.UUID;

public record DownloadTicketRequest(
        DownloadObjectType objectType,
        UUID objectId,
        String extensionId,
        String version,
        DownloadPurpose purpose,
        String deviceId) {
}
