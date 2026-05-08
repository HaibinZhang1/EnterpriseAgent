package com.enterpriseagent.hub.extension;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.pagination.PageResult;

@RestController
@RequestMapping("/api/community")
public class ExtensionCommunityAliasController {
    private final ExtensionCatalogService service;
    private final CurrentUserProvider currentUserProvider;

    public ExtensionCommunityAliasController(ExtensionCatalogService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping("/extensions/search")
    public ApiResponse<PageResult<Map<String, Object>>> search(@RequestParam(required = false) String q,
            @RequestParam(required = false) ExtensionType type, @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.search(currentUserProvider.requireCurrentUser(), q, type, page, pageSize));
    }

    @GetMapping("/extensions/{extensionId}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable String extensionId) {
        return ApiResponse.success(service.communityDetail(currentUserProvider.requireCurrentUser(), extensionId));
    }

    @GetMapping("/rankings")
    public ApiResponse<Map<String, Object>> rankings() {
        return ApiResponse.success(service.communityHome(currentUserProvider.requireCurrentUser()));
    }
}
