package com.enterpriseagent.hub.organization;

import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.auth.PasswordResetPurpose;
import com.enterpriseagent.hub.auth.PasswordResetToken;
import com.enterpriseagent.hub.auth.PasswordResetTokenRepository;
import com.enterpriseagent.hub.auth.PasswordService;
import com.enterpriseagent.hub.auth.PhoneMasker;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.SessionService;
import com.enterpriseagent.hub.auth.TokenService;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.common.audit.AuditRecord;
import com.enterpriseagent.hub.common.audit.AuditResult;
import com.enterpriseagent.hub.common.audit.AuditService;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.common.pagination.PageResult;
import com.enterpriseagent.hub.organization.dto.CreateUserRequest;
import com.enterpriseagent.hub.organization.dto.ResetPasswordRequest;
import com.enterpriseagent.hub.organization.dto.ResetPasswordResponse;
import com.enterpriseagent.hub.organization.dto.UpdateUserRequest;
import com.enterpriseagent.hub.organization.dto.UserActionRequest;
import com.enterpriseagent.hub.organization.dto.UserAdminDetailDto;
import com.enterpriseagent.hub.organization.dto.UserAdminListItem;

@Service
public class UserService {
    private final UserRepository userRepository;
    private final DepartmentRepository departmentRepository;
    private final ManagementScopeService managementScopeService;
    private final DepartmentTreeService departmentTreeService;
    private final LastSystemAdminGuard lastSystemAdminGuard;
    private final PasswordService passwordService;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final TokenService tokenService;
    private final SessionService sessionService;
    private final AuditService auditService;
    private final com.enterpriseagent.hub.auth.AuthProperties authProperties;

    public UserService(UserRepository userRepository, DepartmentRepository departmentRepository,
            ManagementScopeService managementScopeService, DepartmentTreeService departmentTreeService,
            LastSystemAdminGuard lastSystemAdminGuard, PasswordService passwordService,
            PasswordResetTokenRepository passwordResetTokenRepository, TokenService tokenService,
            SessionService sessionService, AuditService auditService,
            com.enterpriseagent.hub.auth.AuthProperties authProperties) {
        this.userRepository = userRepository;
        this.departmentRepository = departmentRepository;
        this.managementScopeService = managementScopeService;
        this.departmentTreeService = departmentTreeService;
        this.lastSystemAdminGuard = lastSystemAdminGuard;
        this.passwordService = passwordService;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.tokenService = tokenService;
        this.sessionService = sessionService;
        this.auditService = auditService;
        this.authProperties = authProperties;
    }

    @Transactional(readOnly = true)
    public PageResult<UserAdminListItem> list(CurrentUser actor, String keyword, UUID departmentId,
            boolean includeChildren, Role role, UserStatus status, int page, int pageSize) {
        requireAdmin(actor, "user.list", null);
        var visibleDeptIds = actor.isSystemAdmin()
                ? departmentRepository.findByStatusNot(DepartmentStatus.DELETED).stream().map(Department::getId).collect(Collectors.toSet())
                : departmentTreeService.selfAndDescendantIds(actor.departmentId(), true);
        if (departmentId != null) {
            var requested = includeChildren ? departmentTreeService.selfAndDescendantIds(departmentId, true) : java.util.Set.of(departmentId);
            visibleDeptIds.retainAll(requested);
        }
        if (visibleDeptIds.isEmpty()) {
            return PageResult.of(java.util.List.of(), page, pageSize);
        }
        Map<UUID, Department> departmentsById = departmentRepository.findAllById(visibleDeptIds).stream()
                .collect(Collectors.toMap(Department::getId, Function.identity()));
        String normalizedKeyword = keyword == null ? "" : keyword.trim().toLowerCase();
        var items = userRepository.findByDepartmentIdInAndStatusNot(visibleDeptIds, UserStatus.DELETED).stream()
                .filter(user -> role == null || user.getRole() == role)
                .filter(user -> status == null || user.getStatus() == status)
                .filter(user -> !StringUtils.hasText(normalizedKeyword)
                        || user.getName().toLowerCase().contains(normalizedKeyword)
                        || user.getPhone().contains(normalizedKeyword))
                .sorted(Comparator.comparing(User::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .filter(user -> departmentsById.containsKey(user.getDepartmentId()))
                .map(user -> UserAdminListItem.from(user, departmentsById.get(user.getDepartmentId())))
                .toList();
        return PageResult.of(items, page, pageSize);
    }

    @Transactional
    public UserAdminDetailDto create(CurrentUser actor, CreateUserRequest request) {
        Department department = requireActiveDepartment(request.departmentId());
        if (!managementScopeService.canAssign(actor, request.role(), request.departmentId())) {
            deny(actor, "user.create", null, "create target outside management scope");
        }
        if (userRepository.existsByPhoneAndStatusNot(request.phone(), UserStatus.DELETED)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "手机号已存在");
        }
        User user = new User(request.name(), request.phone(), passwordService.hash(request.initialPassword()),
                PasswordService.ALGORITHM, request.departmentId(), request.role());
        user.setMustChangePassword(request.mustChangePassword());
        User saved = userRepository.save(user);
        audit(actor, "user.create", saved, AuditResult.SUCCESS, request.reason(), null,
                Map.of("role", saved.getRole().name(), "departmentId", saved.getDepartmentId().toString(), "phoneMasked", PhoneMasker.mask(saved.getPhone())));
        return UserAdminDetailDto.from(saved, department);
    }

    @Transactional(readOnly = true)
    public UserAdminDetailDto get(CurrentUser actor, UUID id) {
        User user = requireUser(id);
        if (!managementScopeService.canManageUser(actor, user) && !actor.isSystemAdmin()) {
            deny(actor, "user.read", user, "outside management scope");
        }
        return UserAdminDetailDto.from(user, departmentRepository.findById(user.getDepartmentId()).orElseThrow());
    }

    @Transactional
    public UserAdminDetailDto update(CurrentUser actor, UUID id, UpdateUserRequest request) {
        User user = requireUser(id);
        if (!managementScopeService.canManageUser(actor, user)) {
            deny(actor, "user.update", user, "outside management scope");
        }
        String beforeRole = user.getRole().name();
        UUID beforeDepartment = user.getDepartmentId();
        Role newRole = request.role() == null ? user.getRole() : request.role();
        UUID newDepartmentId = request.departmentId() == null ? user.getDepartmentId() : request.departmentId();
        if (!managementScopeService.canAssign(actor, newRole, newDepartmentId)) {
            deny(actor, "user.update", user, "assignment outside management scope");
        }
        requireActiveDepartment(newDepartmentId);
        lastSystemAdminGuard.ensureUserChangeKeepsSystemAdmin(user, newRole, user.getStatus(), newDepartmentId);
        boolean invalidate = false;
        if (StringUtils.hasText(request.name())) user.setName(request.name());
        if (StringUtils.hasText(request.phone()) && !request.phone().equals(user.getPhone())) {
            if (userRepository.existsByPhoneAndStatusNot(request.phone(), UserStatus.DELETED)) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "手机号已存在");
            }
            user.setPhone(request.phone());
            invalidate = true;
        }
        if (request.role() != null && request.role() != user.getRole()) {
            user.setRole(request.role());
            invalidate = true;
        }
        if (request.departmentId() != null && !request.departmentId().equals(user.getDepartmentId())) {
            user.setDepartmentId(request.departmentId());
            invalidate = true;
        }
        if (invalidate) sessionService.revokeAllForUser(user.getId(), "user_changed");
        audit(actor, "user.update", user, AuditResult.SUCCESS, request.reason(),
                Map.of("role", beforeRole, "departmentId", beforeDepartment.toString()),
                Map.of("role", user.getRole().name(), "departmentId", user.getDepartmentId().toString()));
        return UserAdminDetailDto.from(user, departmentRepository.findById(user.getDepartmentId()).orElseThrow());
    }

    @Transactional
    public UserAdminDetailDto freeze(CurrentUser actor, UUID id, UserActionRequest request) {
        User user = requireUser(id);
        if (!managementScopeService.canManageUser(actor, user)) deny(actor, "user.freeze", user, "outside management scope");
        lastSystemAdminGuard.ensureUserChangeKeepsSystemAdmin(user, user.getRole(), UserStatus.FROZEN, user.getDepartmentId());
        user.setStatus(UserStatus.FROZEN);
        sessionService.revokeAllForUser(user.getId(), "user_frozen");
        audit(actor, "user.freeze", user, AuditResult.SUCCESS, request == null ? null : request.reason(), null, Map.of("status", "FROZEN"));
        return UserAdminDetailDto.from(user, departmentRepository.findById(user.getDepartmentId()).orElseThrow());
    }

    @Transactional
    public UserAdminDetailDto unfreeze(CurrentUser actor, UUID id, UserActionRequest request) {
        User user = requireUser(id);
        if (!managementScopeService.canManageUser(actor, user)) deny(actor, "user.unfreeze", user, "outside management scope");
        user.setStatus(UserStatus.ACTIVE);
        audit(actor, "user.unfreeze", user, AuditResult.SUCCESS, request == null ? null : request.reason(), null, Map.of("status", "ACTIVE"));
        return UserAdminDetailDto.from(user, departmentRepository.findById(user.getDepartmentId()).orElseThrow());
    }

    @Transactional
    public void delete(CurrentUser actor, UUID id, UserActionRequest request) {
        User user = requireUser(id);
        if (!managementScopeService.canManageUser(actor, user)) deny(actor, "user.delete", user, "outside management scope");
        lastSystemAdminGuard.ensureUserChangeKeepsSystemAdmin(user, user.getRole(), UserStatus.DELETED, user.getDepartmentId());
        user.setStatus(UserStatus.DELETED);
        sessionService.revokeAllForUser(user.getId(), "user_deleted");
        audit(actor, "user.delete", user, AuditResult.SUCCESS, request == null ? null : request.reason(), null, Map.of("status", "DELETED"));
    }

    @Transactional
    public ResetPasswordResponse resetPassword(CurrentUser actor, UUID id, ResetPasswordRequest request) {
        User user = requireUser(id);
        if (!managementScopeService.canManageUser(actor, user)) deny(actor, "user.reset_password", user, "outside management scope");
        String token = tokenService.newToken();
        OffsetDateTime expiresAt = OffsetDateTime.now().plus(authProperties.resetTokenTtl());
        passwordResetTokenRepository.save(new PasswordResetToken(user.getId(), tokenService.hash(token),
                PasswordResetPurpose.ADMIN_RESET, expiresAt, actor.id()));
        user.setMustChangePassword(request.mustChangePassword());
        sessionService.revokeAllForUser(user.getId(), "password_reset");
        audit(actor, "user.password_reset", user, AuditResult.SUCCESS, request.reason(), null,
                Map.of("mustChangePassword", request.mustChangePassword()));
        return new ResetPasswordResponse(token, expiresAt, request.mustChangePassword());
    }

    private User requireUser(UUID id) {
        return userRepository.findByIdAndStatusNot(id, UserStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "用户不存在"));
    }

    private Department requireActiveDepartment(UUID id) {
        Department department = departmentRepository.findByIdAndStatusNot(id, DepartmentStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "部门不存在"));
        if (department.getStatus() != DepartmentStatus.ACTIVE) {
            throw new BusinessException(ErrorCode.DEPARTMENT_DISABLED, "部门已停用");
        }
        return department;
    }

    private void requireAdmin(CurrentUser actor, String action, User target) {
        if (!actor.isAdmin()) {
            deny(actor, action, target, "admin role required");
        }
    }

    private void deny(CurrentUser actor, String action, User target, String reason) {
        audit(actor, action, target, AuditResult.FAILURE, reason, null, null);
        throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权执行该操作");
    }

    private void audit(CurrentUser actor, String action, User target, AuditResult result, String reason,
            Map<String, Object> before, Map<String, Object> after) {
        AuditRecord record = AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(Map.of("name", actor.name(), "role", actor.role().name()))
                .actorDepartmentSnapshot(Map.of("departmentId", actor.departmentId().toString(), "departmentName", actor.departmentName()))
                .objectType("user")
                .objectId(target == null ? null : target.getId().toString())
                .objectNameSnapshot(target == null ? null : target.getName())
                .action(action)
                .result(result)
                .reason(reason)
                .beforeSummary(before)
                .afterSummary(after)
                .build();
        if (result == AuditResult.FAILURE) {
            auditService.recordFailure(record);
        } else {
            auditService.record(record);
        }
    }
}
