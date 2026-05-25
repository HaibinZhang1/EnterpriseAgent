package com.enterpriseagent.hub.device;

import java.util.Map;

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
public class ClientDeviceController {
    private final ClientDeviceService service;
    private final CurrentUserProvider currentUserProvider;

    public ClientDeviceController(ClientDeviceService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @PostMapping("/client-devices/register")
    public ApiResponse<Map<String, Object>> register(@RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.register(currentUserProvider.requireCurrentUser(), request));
    }

    @PostMapping("/client-devices/heartbeat")
    public ApiResponse<Map<String, Object>> heartbeat(@RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.heartbeat(currentUserProvider.requireCurrentUser(), request));
    }

    @PostMapping("/client-devices/events")
    public ApiResponse<Map<String, Object>> events(@RequestBody Map<String, Object> request) {
        return ApiResponse.success(service.events(currentUserProvider.requireCurrentUser(), request));
    }

    @GetMapping("/admin/client-devices")
    public ApiResponse<PageResult<Map<String, Object>>> list(@RequestParam(required = false) String keyword,
            @RequestParam(required = false) String departmentId,
            @RequestParam(defaultValue = "false") boolean includeChildren,
            @RequestParam(required = false) String clientVersion,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.list(currentUserProvider.requireCurrentUser(), keyword, departmentId,
                includeChildren, clientVersion, status, page, pageSize));
    }

    @GetMapping("/admin/client-devices/{deviceId}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable String deviceId) {
        return ApiResponse.success(service.detail(currentUserProvider.requireCurrentUser(), deviceId));
    }
}
