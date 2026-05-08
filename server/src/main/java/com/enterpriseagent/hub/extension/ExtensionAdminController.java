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
@RequestMapping("/api/admin/extensions")
public class ExtensionAdminController {
    private final ExtensionCatalogService service;
    private final ExtensionGovernanceService governanceService;
    private final CurrentUserProvider currentUserProvider;

    public ExtensionAdminController(ExtensionCatalogService service, ExtensionGovernanceService governanceService,
            CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.governanceService = governanceService;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping
    public ApiResponse<PageResult<Map<String, Object>>> list(@RequestParam(required = false) String keyword,
            @RequestParam(required = false) ExtensionType type, @RequestParam(required = false) ExtensionStatus status,
            @RequestParam(required = false) VisibilityMode visibilityMode, @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.adminList(currentUserProvider.requireCurrentUser(), keyword, type, status,
                visibilityMode, page, pageSize));
    }

    @GetMapping("/{extensionId}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable String extensionId) {
        return ApiResponse.success(service.adminDetail(currentUserProvider.requireCurrentUser(), extensionId));
    }

    @GetMapping("/{extensionId}/versions")
    public ApiResponse<Object> versions(@PathVariable String extensionId) {
        return ApiResponse.success(service.adminVersions(currentUserProvider.requireCurrentUser(), extensionId));
    }

    @PostMapping("/{extensionId}/delist")
    public ApiResponse<Map<String, Object>> delist(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request) {
        return ApiResponse.success(governanceService.adminDelist(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/security-delist")
    public ApiResponse<Map<String, Object>> securityDelist(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request) {
        return ApiResponse.success(governanceService.adminSecurityDelist(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/relist")
    public ApiResponse<Map<String, Object>> relist(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request) {
        return ApiResponse.success(governanceService.adminRelist(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/archive")
    public ApiResponse<Map<String, Object>> archive(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request) {
        return ApiResponse.success(governanceService.adminArchive(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/scope/reduce")
    public ApiResponse<Map<String, Object>> reduceScope(@PathVariable String extensionId,
            @RequestBody ExtensionGovernanceRequest request) {
        return ApiResponse.success(governanceService.adminReduceScope(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/visibility/reduce")
    public ApiResponse<Map<String, Object>> reduceVisibility(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request) {
        return ApiResponse.success(governanceService.adminReduceVisibility(currentUserProvider.requireCurrentUser(), extensionId, request));
    }

    @PostMapping("/{extensionId}/ownership-transfer")
    public ApiResponse<Map<String, Object>> transferOwnership(@PathVariable String extensionId,
            @RequestBody ExtensionGovernanceRequest request) {
        return ApiResponse.success(governanceService.adminTransferOwnership(currentUserProvider.requireCurrentUser(), extensionId, request));
    }
}
