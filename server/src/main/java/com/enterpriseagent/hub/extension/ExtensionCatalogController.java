package com.enterpriseagent.hub.extension;

import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
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
@RequestMapping("/api/extensions")
public class ExtensionCatalogController {
    private final ExtensionCatalogService service;
    private final CurrentUserProvider currentUserProvider;

    public ExtensionCatalogController(ExtensionCatalogService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping("/community/home")
    public ApiResponse<Map<String, Object>> home() {
        return ApiResponse.success(service.communityHome(currentUserProvider.requireCurrentUser()));
    }

    @GetMapping("/search")
    public ApiResponse<PageResult<Map<String, Object>>> search(@RequestParam(required = false) String q,
            @RequestParam(required = false) ExtensionType type, @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.search(currentUserProvider.requireCurrentUser(), q, type, page, pageSize));
    }

    @GetMapping("/{extensionId}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable String extensionId) {
        return ApiResponse.success(service.communityDetail(currentUserProvider.requireCurrentUser(), extensionId));
    }

    @PostMapping("/{extensionId}/star")
    public ApiResponse<Map<String, Object>> star(@PathVariable String extensionId, @RequestBody StarRequest request) {
        return ApiResponse.success(service.setStar(currentUserProvider.requireCurrentUser(), extensionId, request.starred()));
    }

    @DeleteMapping("/{extensionId}/star")
    public ApiResponse<Map<String, Object>> unstar(@PathVariable String extensionId) {
        return ApiResponse.success(service.setStar(currentUserProvider.requireCurrentUser(), extensionId, false));
    }

    @GetMapping("/{extensionId}/versions")
    public ApiResponse<Object> versions(@PathVariable String extensionId) {
        return ApiResponse.success(service.communityVersions(currentUserProvider.requireCurrentUser(), extensionId));
    }

    @GetMapping("/{extensionId}/mcp-definition")
    public ApiResponse<Map<String, Object>> mcpDefinition(@PathVariable String extensionId) {
        return ApiResponse.success(service.mcpDefinition(currentUserProvider.requireCurrentUser(), extensionId));
    }

    @GetMapping("/{extensionId}/plugin-definition")
    public ApiResponse<Map<String, Object>> pluginDefinition(@PathVariable String extensionId) {
        return ApiResponse.success(service.pluginDefinition(currentUserProvider.requireCurrentUser(), extensionId));
    }
}
