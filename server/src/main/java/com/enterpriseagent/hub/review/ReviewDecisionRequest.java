package com.enterpriseagent.hub.review;

import java.util.List;
import java.util.UUID;

public record ReviewDecisionRequest(UUID revisionId, ReviewDecision decision, String comment, List<String> reasonCodes) {
}
