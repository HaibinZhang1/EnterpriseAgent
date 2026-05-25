package com.enterpriseagent.hub.clientupdate;

import java.util.Map;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.pagination.PageResult;

@RestController
@RequestMapping("/api")
public class ClientUpdateController {
    private final ClientUpdateService service;
    private final CurrentUserProvider currentUserProvider;

    public ClientUpdateController(ClientUpdateService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping("/client-updates/check")
    public ApiResponse<Map<String, Object>> check(@RequestParam String deviceId,
            @RequestParam String currentVersion,
            @RequestParam(defaultValue = "WINDOWS") String platform,
            @RequestParam String arch,
            @RequestParam(defaultValue = "STABLE") String channel) {
        return ApiResponse.success(service.check(currentUserProvider.requireCurrentUser(), deviceId, currentVersion, platform, arch, channel));
    }

    @PostMapping("/client-updates/{versionId}/download-ticket")
    public ApiResponse<Map<String, Object>> downloadTicket(@PathVariable UUID versionId,
            @RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.downloadTicket(currentUserProvider.requireCurrentUser(), versionId, request));
    }

    @PostMapping("/client-updates/events")
    public ApiResponse<Map<String, Object>> event(@RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.recordClientEvent(currentUserProvider.requireCurrentUser(), request));
    }

    @GetMapping("/admin/client-updates")
    public ApiResponse<PageResult<Map<String, Object>>> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String version,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.list(currentUserProvider.requireCurrentUser(), status, version, page, pageSize));
    }

    @PostMapping("/admin/client-updates")
    public ApiResponse<Map<String, Object>> create(@RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.create(currentUserProvider.requireCurrentUser(), request));
    }

    @PostMapping("/admin/client-updates/{id}/publish")
    public ApiResponse<Map<String, Object>> publish(@PathVariable UUID id, @RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.transition(currentUserProvider.requireCurrentUser(), id, request, "PUBLISHED"));
    }

    @PostMapping("/admin/client-updates/{id}/pause")
    public ApiResponse<Map<String, Object>> pause(@PathVariable UUID id, @RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.transition(currentUserProvider.requireCurrentUser(), id, request, "PAUSED"));
    }

    @PostMapping("/admin/client-updates/{id}/withdraw")
    public ApiResponse<Map<String, Object>> withdraw(@PathVariable UUID id, @RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.transition(currentUserProvider.requireCurrentUser(), id, request, "WITHDRAWN"));
    }

    @GetMapping("/admin/client-updates/events")
    public ApiResponse<PageResult<Map<String, Object>>> events(@RequestParam(required = false) UUID versionId,
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) String result,
            @RequestParam(required = false) String errorCode,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.events(currentUserProvider.requireCurrentUser(), versionId, deviceId, result,
                errorCode, page, pageSize));
    }
}
