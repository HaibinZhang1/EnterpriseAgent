package com.enterpriseagent.hub.organization;

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
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.idempotency.IdempotencyService;
import com.enterpriseagent.hub.common.pagination.PageResult;
import com.enterpriseagent.hub.organization.dto.CreateUserRequest;
import com.enterpriseagent.hub.organization.dto.ResetPasswordRequest;
import com.enterpriseagent.hub.organization.dto.ResetPasswordResponse;
import com.enterpriseagent.hub.organization.dto.UpdateUserRequest;
import com.enterpriseagent.hub.organization.dto.UserActionRequest;
import com.enterpriseagent.hub.organization.dto.UserAdminDetailDto;
import com.enterpriseagent.hub.organization.dto.UserAdminListItem;

@RestController
@RequestMapping("/api/admin/users")
public class UserAdminController {
    private final UserService userService;
    private final CurrentUserProvider currentUserProvider;
    private final IdempotencyService idempotencyService;

    public UserAdminController(UserService userService, CurrentUserProvider currentUserProvider,
            IdempotencyService idempotencyService) {
        this.userService = userService;
        this.currentUserProvider = currentUserProvider;
        this.idempotencyService = idempotencyService;
    }

    @GetMapping
    public ApiResponse<PageResult<UserAdminListItem>> list(@RequestParam(required = false) String keyword,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(defaultValue = "false") boolean includeChildren,
            @RequestParam(required = false) Role role,
            @RequestParam(required = false) UserStatus status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(userService.list(currentUserProvider.requireCurrentUser(), keyword, departmentId,
                includeChildren, role, status, page, pageSize));
    }

    @PostMapping
    public ApiResponse<UserAdminDetailDto> create(@Valid @RequestBody CreateUserRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.user.create", idempotencyKey, request,
                UserAdminDetailDto.class, () -> userService.create(actor, request)));
    }

    @GetMapping("/{id}")
    public ApiResponse<UserAdminDetailDto> get(@PathVariable UUID id) {
        return ApiResponse.success(userService.get(currentUserProvider.requireCurrentUser(), id));
    }

    @PatchMapping("/{id}")
    public ApiResponse<UserAdminDetailDto> update(@PathVariable UUID id, @RequestBody UpdateUserRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.user.update:" + id, idempotencyKey,
                request, UserAdminDetailDto.class, () -> userService.update(actor, id, request)));
    }

    @PostMapping("/{id}/freeze")
    public ApiResponse<UserAdminDetailDto> freeze(@PathVariable UUID id,
            @RequestBody(required = false) UserActionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.user.freeze:" + id, idempotencyKey,
                request, UserAdminDetailDto.class, () -> userService.freeze(actor, id, request)));
    }

    @PostMapping("/{id}/unfreeze")
    public ApiResponse<UserAdminDetailDto> unfreeze(@PathVariable UUID id,
            @RequestBody(required = false) UserActionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.user.unfreeze:" + id, idempotencyKey,
                request, UserAdminDetailDto.class, () -> userService.unfreeze(actor, id, request)));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable UUID id, @RequestBody(required = false) UserActionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        idempotencyService.execute(actor, "admin.user.delete:" + id, idempotencyKey, request, Void.class, () -> {
            userService.delete(actor, id, request);
            return null;
        });
        return ApiResponse.success(null);
    }

    @PostMapping("/{id}/reset-password")
    public ApiResponse<ResetPasswordResponse> resetPassword(@PathVariable UUID id,
            @RequestBody ResetPasswordRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var actor = currentUserProvider.requireCurrentUser();
        return ApiResponse.success(idempotencyService.execute(actor, "admin.user.reset_password:" + id, idempotencyKey,
                request, ResetPasswordResponse.class, () -> userService.resetPassword(actor, id, request)));
    }
}
