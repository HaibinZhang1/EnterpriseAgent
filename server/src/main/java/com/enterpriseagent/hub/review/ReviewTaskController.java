package com.enterpriseagent.hub.review;

import java.util.Map;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.idempotency.IdempotencyService;
import com.enterpriseagent.hub.common.pagination.PageResult;
import com.enterpriseagent.hub.notification.NotificationOutboxConsumer;

@RestController
@RequestMapping("/api/reviews/tasks")
public class ReviewTaskController {
    private final ReviewService service;
    private final CurrentUserProvider currentUserProvider;
    private final IdempotencyService idempotencyService;
    private final NotificationOutboxConsumer outboxConsumer;

    public ReviewTaskController(ReviewService service, CurrentUserProvider currentUserProvider,
            IdempotencyService idempotencyService, NotificationOutboxConsumer outboxConsumer) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
        this.idempotencyService = idempotencyService;
        this.outboxConsumer = outboxConsumer;
    }

    @GetMapping
    public ApiResponse<PageResult<Map<String, Object>>> tasks(@RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.tasks(currentUserProvider.requireCurrentUser(), status, page, pageSize));
    }

    @GetMapping("/{submissionId}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable UUID submissionId) {
        return ApiResponse.success(service.detail(currentUserProvider.requireCurrentUser(), submissionId));
    }

    @PostMapping("/{submissionId}/decision")
    public ApiResponse<Map<String, Object>> decision(@PathVariable UUID submissionId,
            @RequestBody ReviewDecisionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return decide(submissionId, request, idempotencyKey);
    }

    @PostMapping("/{submissionId}/approve")
    public ApiResponse<Map<String, Object>> approve(@PathVariable UUID submissionId,
            @RequestBody ReviewDecisionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return decide(submissionId, withDecision(request, ReviewDecision.APPROVE), idempotencyKey);
    }

    @PostMapping("/{submissionId}/request-changes")
    public ApiResponse<Map<String, Object>> requestChanges(@PathVariable UUID submissionId,
            @RequestBody ReviewDecisionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return decide(submissionId, withDecision(request, ReviewDecision.REQUEST_CHANGES), idempotencyKey);
    }

    @PostMapping("/{submissionId}/reject")
    public ApiResponse<Map<String, Object>> reject(@PathVariable UUID submissionId,
            @RequestBody ReviewDecisionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return decide(submissionId, withDecision(request, ReviewDecision.REJECT), idempotencyKey);
    }

    private ApiResponse<Map<String, Object>> decide(UUID submissionId, ReviewDecisionRequest request, String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        @SuppressWarnings("unchecked")
        Map<String, Object> response = idempotencyService.execute(actor, "review.decision:" + submissionId,
                idempotencyKey, request, (Class<Map<String, Object>>) (Class<?>) Map.class,
                () -> service.decide(actor, submissionId, request));
        outboxConsumer.processPending();
        return ApiResponse.success(response);
    }

    private ReviewDecisionRequest withDecision(ReviewDecisionRequest request, ReviewDecision decision) {
        return new ReviewDecisionRequest(request.revisionId(), decision, request.comment(), request.reasonCodes());
    }
}
