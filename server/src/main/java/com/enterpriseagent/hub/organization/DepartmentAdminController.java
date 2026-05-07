package com.enterpriseagent.hub.organization;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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
import com.enterpriseagent.hub.organization.dto.CreateDepartmentRequest;
import com.enterpriseagent.hub.organization.dto.DepartmentActionRequest;
import com.enterpriseagent.hub.organization.dto.DepartmentDto;
import com.enterpriseagent.hub.organization.dto.DepartmentTreeDto;
import com.enterpriseagent.hub.organization.dto.UpdateDepartmentRequest;

@RestController
@RequestMapping("/api/admin/departments")
public class DepartmentAdminController {
    private final DepartmentService departmentService;
    private final CurrentUserProvider currentUserProvider;
    private final IdempotencyService idempotencyService;

    public DepartmentAdminController(DepartmentService departmentService, CurrentUserProvider currentUserProvider,
            IdempotencyService idempotencyService) {
        this.departmentService = departmentService;
        this.currentUserProvider = currentUserProvider;
        this.idempotencyService = idempotencyService;
    }

    @GetMapping("/tree")
    public ApiResponse<List<DepartmentTreeDto>> tree(@RequestParam(defaultValue = "false") boolean includeDisabled,
            @RequestParam(required = false) UUID rootDepartmentId) {
        return ApiResponse.success(departmentService.tree(currentUserProvider.requireCurrentUser(), includeDisabled,
                rootDepartmentId));
    }

    @PostMapping
    public ApiResponse<DepartmentDto> create(@Valid @RequestBody CreateDepartmentRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.department.create", idempotencyKey,
                request, DepartmentDto.class, () -> departmentService.create(actor, request)));
    }

    @GetMapping("/{id}")
    public ApiResponse<DepartmentDto> get(@PathVariable UUID id) {
        return ApiResponse.success(departmentService.get(currentUserProvider.requireCurrentUser(), id));
    }

    @PatchMapping("/{id}")
    public ApiResponse<DepartmentDto> update(@PathVariable UUID id, @Valid @RequestBody UpdateDepartmentRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.department.update:" + id, idempotencyKey,
                request, DepartmentDto.class, () -> departmentService.update(actor, id, request)));
    }

    @PostMapping("/{id}/disable")
    public ApiResponse<DepartmentDto> disable(@PathVariable UUID id,
            @RequestBody(required = false) DepartmentActionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.department.disable:" + id, idempotencyKey,
                request, DepartmentDto.class, () -> departmentService.disable(actor, id, request)));
    }

    @PostMapping("/{id}/enable")
    public ApiResponse<DepartmentDto> enable(@PathVariable UUID id,
            @RequestBody(required = false) DepartmentActionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.department.enable:" + id, idempotencyKey,
                request, DepartmentDto.class, () -> departmentService.enable(actor, id, request)));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable UUID id, @RequestBody(required = false) DepartmentActionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        idempotencyService.execute(actor, "admin.department.delete:" + id, idempotencyKey, request, Void.class, () -> {
            departmentService.delete(actor, id, request);
            return null;
        });
        return ApiResponse.success(null);
    }
}
