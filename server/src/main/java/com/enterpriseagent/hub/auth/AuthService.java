package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.enterpriseagent.hub.auth.dto.ChangePasswordRequest;
import com.enterpriseagent.hub.auth.dto.CompleteResetPasswordRequest;
import com.enterpriseagent.hub.auth.dto.LoginRequest;
import com.enterpriseagent.hub.auth.dto.LoginResponse;
import com.enterpriseagent.hub.auth.dto.PermissionSummaryDto;
import com.enterpriseagent.hub.auth.dto.UserSummaryDto;
import com.enterpriseagent.hub.common.audit.AuditRecord;
import com.enterpriseagent.hub.common.audit.AuditResult;
import com.enterpriseagent.hub.common.audit.AuditService;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.common.request.RequestContext;
import com.enterpriseagent.hub.organization.Department;
import com.enterpriseagent.hub.organization.DepartmentRepository;
import com.enterpriseagent.hub.organization.DepartmentStatus;
import com.enterpriseagent.hub.organization.LastSystemAdminGuard;

@Service
public class AuthService {
    private final UserRepository userRepository;
    private final DepartmentRepository departmentRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordService passwordService;
    private final LoginAttemptService loginAttemptService;
    private final SessionService sessionService;
    private final TokenService tokenService;
    private final PermissionService permissionService;
    private final AuditService auditService;
    private final AuthProperties properties;
    private final LastSystemAdminGuard lastSystemAdminGuard;

    public AuthService(UserRepository userRepository, DepartmentRepository departmentRepository,
            PasswordResetTokenRepository passwordResetTokenRepository, PasswordService passwordService,
            LoginAttemptService loginAttemptService, SessionService sessionService, TokenService tokenService,
            PermissionService permissionService, AuditService auditService, AuthProperties properties,
            LastSystemAdminGuard lastSystemAdminGuard) {
        this.userRepository = userRepository;
        this.departmentRepository = departmentRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.passwordService = passwordService;
        this.loginAttemptService = loginAttemptService;
        this.sessionService = sessionService;
        this.tokenService = tokenService;
        this.permissionService = permissionService;
        this.auditService = auditService;
        this.properties = properties;
        this.lastSystemAdminGuard = lastSystemAdminGuard;
    }

    @Transactional(noRollbackFor = BusinessException.class)
    public LoginResponse login(LoginRequest request, String ip, String userAgent) {
        String phone = normalizePhone(request.phone());
        ClientType clientType = request.clientType() == null ? ClientType.DESKTOP : request.clientType();
        User user = userRepository.findByPhoneAndStatusNot(phone, UserStatus.DELETED).orElse(null);
        if (loginAttemptService.isThrottled(phone, ip) && !canBypassThrottle(user)) {
            auditLogin(null, phone, "auth.login.failure", AuditResult.FAILURE, "account_locked", ip, userAgent);
            throw new BusinessException(ErrorCode.ACCOUNT_LOCKED, "账号暂时锁定");
        }
        if (user == null || !passwordService.matches(request.password(), user.getPasswordHash())) {
            loginAttemptService.record(phone, user == null ? null : user.getId(), ip, userAgent, LoginAttemptResult.FAILED,
                    "bad_credentials");
            if (user != null && loginAttemptService.isThrottled(phone, ip)) {
                OffsetDateTime lockedUntil = OffsetDateTime.now().plus(properties.lockDuration());
                if (!lastSystemAdminGuard.wouldLockLastAvailableSystemAdmin(user, lockedUntil)) {
                    user.setLockedUntil(lockedUntil);
                }
            }
            auditLogin(user, phone, "auth.login.failure", AuditResult.FAILURE, "bad_credentials", ip, userAgent);
            throw new BusinessException(ErrorCode.UNAUTHENTICATED, "手机号或密码错误");
        }
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(OffsetDateTime.now())) {
            auditLogin(user, phone, "auth.login.failure", AuditResult.FAILURE, "account_locked", ip, userAgent);
            throw new BusinessException(ErrorCode.ACCOUNT_LOCKED, "账号暂时锁定");
        }
        if (user.getStatus() != UserStatus.ACTIVE) {
            auditLogin(user, phone, "auth.login.failure", AuditResult.FAILURE, "user_inactive", ip, userAgent);
            throw new BusinessException(ErrorCode.UNAUTHENTICATED, "账号不可登录");
        }
        Department department = departmentRepository.findByIdAndStatusNot(user.getDepartmentId(), DepartmentStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHENTICATED, "账号不可登录"));
        if (department.getStatus() != DepartmentStatus.ACTIVE) {
            auditLogin(user, phone, "auth.login.failure", AuditResult.FAILURE, "department_disabled", ip, userAgent);
            throw new BusinessException(ErrorCode.DEPARTMENT_DISABLED, "部门已停用");
        }
        if (clientType == ClientType.ADMIN_WEB && !permissionService.canUseAdminWeb(user)) {
            auditLogin(user, phone, "auth.login.failure", AuditResult.FAILURE, "admin_web_denied", ip, userAgent);
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权登录管理端");
        }
        user.setLockedUntil(null);
        user.setLastLoginAt(OffsetDateTime.now());
        loginAttemptService.record(phone, user.getId(), ip, userAgent, LoginAttemptResult.SUCCESS, null);
        SessionService.CreatedSession created = sessionService.create(user, clientType, request.deviceId());
        auditLogin(user, phone, "auth.login.success", AuditResult.SUCCESS, null, ip, userAgent);
        return new LoginResponse(created.token(), created.session().getExpiresAt(), UserSummaryDto.from(user, department),
                new PermissionSummaryDto(permissionService.canUseDesktop(user), permissionService.canUseAdminWeb(user)));
    }

    @Transactional
    public void logout(CurrentUser currentUser) {
        sessionService.revoke(currentUser.sessionId(), "logout");
        auditService.record(AuditRecord.builder()
                .actorId(currentUser.id())
                .actorSnapshot(Map.of("name", currentUser.name(), "role", currentUser.role().name()))
                .objectType("session")
                .objectId(currentUser.sessionId().toString())
                .action("auth.logout")
                .result(AuditResult.SUCCESS)
                .build());
    }

    @Transactional(readOnly = true)
    public UserSummaryDto me(CurrentUser currentUser) {
        User user = userRepository.findByIdAndStatusNot(currentUser.id(), UserStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHENTICATED, "未登录或会话已失效"));
        Department department = departmentRepository.findById(user.getDepartmentId()).orElseThrow();
        return UserSummaryDto.from(user, department);
    }

    @Transactional
    public void changePassword(CurrentUser currentUser, ChangePasswordRequest request) {
        User user = userRepository.findByIdAndStatusNot(currentUser.id(), UserStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHENTICATED, "未登录或会话已失效"));
        if (!passwordService.matches(request.oldPassword(), user.getPasswordHash())) {
            throw new BusinessException(ErrorCode.UNAUTHENTICATED, "旧密码错误");
        }
        passwordService.applyNewPassword(user, request.newPassword(), false);
        sessionService.revokeOtherForUser(user.getId(), currentUser.sessionId(), "password_changed");
        sessionService.revoke(currentUser.sessionId(), "password_changed");
        auditService.record(AuditRecord.builder()
                .actorId(user.getId())
                .actorSnapshot(Map.of("name", user.getName(), "role", user.getRole().name()))
                .objectType("user")
                .objectId(user.getId().toString())
                .action("auth.password.change")
                .result(AuditResult.SUCCESS)
                .afterSummary(Map.of("passwordChanged", true))
                .build());
    }

    @Transactional
    public void completeResetPassword(CompleteResetPasswordRequest request) {
        PasswordResetToken token = passwordResetTokenRepository.findByTokenHash(tokenService.hash(request.resetToken()))
                .orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHENTICATED, "重置凭证无效"));
        if (!token.isUsable(OffsetDateTime.now())) {
            throw new BusinessException(ErrorCode.UNAUTHENTICATED, "重置凭证无效");
        }
        User user = userRepository.findByIdAndStatusNot(token.getUserId(), UserStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "用户不存在"));
        passwordService.applyNewPassword(user, request.newPassword(), false);
        token.markUsed();
        sessionService.revokeAllForUser(user.getId(), "password_reset_completed");
        auditService.record(AuditRecord.builder()
                .actorId(user.getId())
                .objectType("user")
                .objectId(user.getId().toString())
                .action("auth.password_reset.complete")
                .result(AuditResult.SUCCESS)
                .afterSummary(Map.of("resetCompleted", true))
                .build());
    }

    private String normalizePhone(String phone) {
        return phone == null ? "" : phone.trim();
    }

    private boolean canBypassThrottle(User user) {
        return user != null && lastSystemAdminGuard.isOnlyAvailableSystemAdmin(user);
    }

    private void auditLogin(User user, String phone, String action, AuditResult result, String reason, String ip,
            String userAgent) {
        auditService.record(AuditRecord.builder()
                .actorId(user == null ? null : user.getId())
                .actorSnapshot(user == null ? Map.of("phoneMasked", PhoneMasker.mask(phone))
                        : Map.of("name", user.getName(), "phoneMasked", PhoneMasker.mask(user.getPhone()), "role", user.getRole().name()))
                .objectType("auth")
                .objectId(user == null ? null : user.getId().toString())
                .action(action)
                .result(result)
                .reason(reason)
                .ip(ip)
                .userAgent(userAgent)
                .build());
    }
}
