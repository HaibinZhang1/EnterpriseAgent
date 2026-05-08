package com.enterpriseagent.hub.submission;

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
@RequestMapping("/api/submissions")
public class SubmissionController {
    private final SubmissionService service;
    private final CurrentUserProvider currentUserProvider;
    private final IdempotencyService idempotencyService;
    private final NotificationOutboxConsumer outboxConsumer;

    public SubmissionController(SubmissionService service, CurrentUserProvider currentUserProvider,
            IdempotencyService idempotencyService, NotificationOutboxConsumer outboxConsumer) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
        this.idempotencyService = idempotencyService;
        this.outboxConsumer = outboxConsumer;
    }

    @PostMapping
    public ApiResponse<Map<String, Object>> create(@RequestBody SubmissionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        @SuppressWarnings("unchecked")
        Map<String, Object> response = idempotencyService.execute(actor, "submission.create", idempotencyKey, request,
                (Class<Map<String, Object>>) (Class<?>) Map.class, () -> service.create(actor, request));
        outboxConsumer.processPending();
        return ApiResponse.success(response);
    }

    @GetMapping({"/mine", "/my"})
    public ApiResponse<PageResult<Map<String, Object>>> mine(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.mine(currentUserProvider.requireCurrentUser(), page, pageSize));
    }

    @GetMapping("/{submissionId}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable UUID submissionId) {
        return ApiResponse.success(service.detail(currentUserProvider.requireCurrentUser(), submissionId));
    }

    @PostMapping("/{submissionId}/withdraw")
    public ApiResponse<Map<String, Object>> withdraw(@PathVariable UUID submissionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        @SuppressWarnings("unchecked")
        Map<String, Object> response = idempotencyService.execute(actor, "submission.withdraw:" + submissionId,
                idempotencyKey, Map.of("submissionId", submissionId),
                (Class<Map<String, Object>>) (Class<?>) Map.class, () -> service.withdraw(actor, submissionId));
        return ApiResponse.success(response);
    }

    @PostMapping({"/{submissionId}/revisions", "/{submissionId}/resubmit"})
    public ApiResponse<Map<String, Object>> revise(@PathVariable UUID submissionId, @RequestBody SubmissionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        @SuppressWarnings("unchecked")
        Map<String, Object> response = idempotencyService.execute(actor, "submission.revise:" + submissionId,
                idempotencyKey, request, (Class<Map<String, Object>>) (Class<?>) Map.class,
                () -> service.revise(actor, submissionId, request));
        outboxConsumer.processPending();
        return ApiResponse.success(response);
    }
}
