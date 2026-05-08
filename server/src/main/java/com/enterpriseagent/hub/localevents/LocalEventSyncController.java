package com.enterpriseagent.hub.localevents;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;

@RestController
@RequestMapping("/api/local-events")
public class LocalEventSyncController {
    private final CurrentUserProvider currentUserProvider;
    private final LocalEventSyncService service;

    public LocalEventSyncController(CurrentUserProvider currentUserProvider, LocalEventSyncService service) {
        this.currentUserProvider = currentUserProvider;
        this.service = service;
    }

    @PostMapping("/sync")
    public ApiResponse<LocalEventSyncResponse> sync(@RequestBody LocalEventSyncRequest request) {
        return ApiResponse.success(service.sync(currentUserProvider.requireCurrentUser(), request));
    }
}
