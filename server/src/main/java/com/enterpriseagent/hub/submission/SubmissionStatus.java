package com.enterpriseagent.hub.submission;

public enum SubmissionStatus {
    CREATED,
    VALIDATING,
    AI_PRECHECKING,
    PENDING_REVIEW,
    IN_REVIEW,
    CHANGES_REQUESTED,
    REJECTED,
    APPROVED,
    WITHDRAWN
}
