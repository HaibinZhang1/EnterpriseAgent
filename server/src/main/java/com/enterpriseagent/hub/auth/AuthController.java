package com.enterpriseagent.hub.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.dto.ChangePasswordRequest;
import com.enterpriseagent.hub.auth.dto.CompleteResetPasswordRequest;
import com.enterpriseagent.hub.auth.dto.LoginRequest;
import com.enterpriseagent.hub.auth.dto.LoginResponse;
import com.enterpriseagent.hub.auth.dto.UserSummaryDto;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;
    private final CurrentUserProvider currentUserProvider;

    public AuthController(AuthService authService, CurrentUserProvider currentUserProvider) {
        this.authService = authService;
        this.currentUserProvider = currentUserProvider;
    }

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest request, HttpServletRequest servletRequest) {
        return ApiResponse.success(authService.login(request, servletRequest.getRemoteAddr(),
                servletRequest.getHeader("User-Agent")));
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout() {
        authService.logout(currentUserProvider.requireCurrentUser());
        return ApiResponse.success(null);
    }

    @GetMapping("/me")
    public ApiResponse<UserSummaryDto> me() {
        return ApiResponse.success(authService.me(currentUserProvider.requireCurrentUser()));
    }

    @PostMapping("/change-password")
    public ApiResponse<Void> changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(currentUserProvider.requireCurrentUser(), request);
        return ApiResponse.success(null);
    }

    @PostMapping("/reset-password/complete")
    public ApiResponse<Void> completeResetPassword(@Valid @RequestBody CompleteResetPasswordRequest request) {
        authService.completeResetPassword(request);
        return ApiResponse.success(null);
    }

    @PostMapping("/refresh")
    public ApiResponse<Void> refreshUnsupported() {
        throw new BusinessException(ErrorCode.REFRESH_NOT_SUPPORTED, "M2 阶段明确不支持 refresh，请重新登录获取新会话");
    }
}
