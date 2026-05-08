package com.enterpriseagent.hub.notification;

import java.util.Map;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.pagination.PageResult;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService service;
    private final CurrentUserProvider currentUserProvider;

    public NotificationController(NotificationService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping
    public ApiResponse<PageResult<Map<String, Object>>> list(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.list(currentUserProvider.requireCurrentUser(), page, pageSize));
    }

    @PostMapping("/{notificationId}/read")
    public ApiResponse<Map<String, Object>> read(@PathVariable UUID notificationId) {
        return ApiResponse.success(service.markRead(currentUserProvider.requireCurrentUser(), notificationId));
    }
}
