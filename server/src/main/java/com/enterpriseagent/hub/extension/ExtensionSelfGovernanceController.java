package com.enterpriseagent.hub.extension;

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
@RequestMapping("/api/me/extensions")
public class ExtensionSelfGovernanceController {
    private final ExtensionGovernanceService service;
    private final CurrentUserProvider currentUserProvider;

    public ExtensionSelfGovernanceController(ExtensionGovernanceService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping
    public ApiResponse<PageResult<Map<String, Object>>> mine(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.mine(currentUserProvider.requireCurrentUser(), page, pageSize));
    }

    @GetMapping("/{extensionId}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable String extensionId) {
        return ApiResponse.success(service.selfDetail(currentUserProvider.requireCurrentUser(), extensionId));
    }

    @PostMapping("/{extensionId}/delist")
    public ApiResponse<Map<String, Object>> delist(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request) {
        return ApiResponse.success(service.selfDelist(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/scope/reduce")
    public ApiResponse<Map<String, Object>> reduceScope(@PathVariable String extensionId,
            @RequestBody ExtensionGovernanceRequest request) {
        return ApiResponse.success(service.selfReduceScope(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/visibility/reduce")
    public ApiResponse<Map<String, Object>> reduceVisibility(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request) {
        return ApiResponse.success(service.selfReduceVisibility(currentUserProvider.requireCurrentUser(), extensionId, request));
    }
}
