package com.enterpriseagent.hub.extension;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.idempotency.IdempotencyService;
import com.enterpriseagent.hub.common.pagination.PageResult;

@RestController
@RequestMapping("/api/admin/extensions")
public class ExtensionAdminController {
    private final ExtensionCatalogService service;
    private final ExtensionGovernanceService governanceService;
    private final CurrentUserProvider currentUserProvider;
    private final IdempotencyService idempotencyService;

    public ExtensionAdminController(ExtensionCatalogService service, ExtensionGovernanceService governanceService,
            CurrentUserProvider currentUserProvider, IdempotencyService idempotencyService) {
        this.service = service;
        this.governanceService = governanceService;
        this.currentUserProvider = currentUserProvider;
        this.idempotencyService = idempotencyService;
    }

    @GetMapping
    public ApiResponse<PageResult<Map<String, Object>>> list(@RequestParam(required = false) String keyword,
            @RequestParam(required = false) ExtensionType type, @RequestParam(required = false) ExtensionStatus status,
            @RequestParam(required = false) VisibilityMode visibilityMode,
            @RequestParam(required = false) UUID ownerDepartmentId,
            @RequestParam(defaultValue = "false") boolean includeChildren,
            @RequestParam(required = false) UUID maintainerId,
            @RequestParam(required = false) String riskLevel,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.adminList(currentUserProvider.requireCurrentUser(), keyword, type, status,
                visibilityMode, ownerDepartmentId, includeChildren, maintainerId, riskLevel, page, pageSize));
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
            @RequestBody(required = false) ExtensionGovernanceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return executeGovernance(extensionId, "delist", request, idempotencyKey,
                actor -> governanceService.adminDelist(actor, extensionId, request));
    }

    @PostMapping("/{extensionId}/security-delist")
    public ApiResponse<Map<String, Object>> securityDelist(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return executeGovernance(extensionId, "security-delist", request, idempotencyKey,
                actor -> governanceService.adminSecurityDelist(actor, extensionId, request));
    }

    @PostMapping("/{extensionId}/relist")
    public ApiResponse<Map<String, Object>> relist(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return executeGovernance(extensionId, "relist", request, idempotencyKey,
                actor -> governanceService.adminRelist(actor, extensionId, request));
    }

    @PostMapping("/{extensionId}/archive")
    public ApiResponse<Map<String, Object>> archive(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return executeGovernance(extensionId, "archive", request, idempotencyKey,
                actor -> governanceService.adminArchive(actor, extensionId, request));
    }

    @PostMapping("/{extensionId}/scope/reduce")
    public ApiResponse<Map<String, Object>> reduceScope(@PathVariable String extensionId,
            @RequestBody ExtensionGovernanceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return executeGovernance(extensionId, "scope-reduce", request, idempotencyKey,
                actor -> governanceService.adminReduceScope(actor, extensionId, request));
    }

    @PostMapping("/{extensionId}/visibility/reduce")
    public ApiResponse<Map<String, Object>> reduceVisibility(@PathVariable String extensionId,
            @RequestBody(required = false) ExtensionGovernanceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return executeGovernance(extensionId, "visibility-reduce", request, idempotencyKey,
                actor -> governanceService.adminReduceVisibility(actor, extensionId, request));
    }

    @PostMapping("/{extensionId}/ownership-transfer")
    public ApiResponse<Map<String, Object>> transferOwnership(@PathVariable String extensionId,
            @RequestBody ExtensionGovernanceRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return executeGovernance(extensionId, "ownership-transfer", request, idempotencyKey,
                actor -> governanceService.adminTransferOwnership(actor, extensionId, request));
    }

    private ApiResponse<Map<String, Object>> executeGovernance(String extensionId, String action,
            ExtensionGovernanceRequest request, String idempotencyKey,
            Function<CurrentUser, Map<String, Object>> operation) {
        var actor = currentUserProvider.requireCurrentUser();
        String operationName = "admin.extension." + action;
        Map<String, Object> idempotencyRequest = new LinkedHashMap<>();
        idempotencyRequest.put("extensionId", extensionId);
        idempotencyRequest.put("request", request);
        @SuppressWarnings("unchecked")
        Map<String, Object> response = idempotencyService.execute(actor, operationName,
                idempotencyKey, idempotencyRequest, (Class<Map<String, Object>>) (Class<?>) Map.class,
                () -> operation.apply(actor));
        return ApiResponse.success(response);
    }
}
