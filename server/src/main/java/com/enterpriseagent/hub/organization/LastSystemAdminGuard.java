package com.enterpriseagent.hub.organization;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.User;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;

@Component
public class LastSystemAdminGuard {
    private final UserRepository userRepository;
    private final DepartmentRepository departmentRepository;

    public LastSystemAdminGuard(UserRepository userRepository, DepartmentRepository departmentRepository) {
        this.userRepository = userRepository;
        this.departmentRepository = departmentRepository;
    }

    public void ensureUserChangeKeepsSystemAdmin(User target, Role newRole, UserStatus newStatus, UUID newDepartmentId) {
        OffsetDateTime now = OffsetDateTime.now();
        if (!isAvailableSystemAdmin(target, now)) {
            return;
        }
        boolean remainsSystemAdmin = newRole == Role.SYSTEM_ADMIN && newStatus == UserStatus.ACTIVE
                && isDepartmentActive(newDepartmentId) && !isLocked(target.getLockedUntil(), now);
        if (remainsSystemAdmin) {
            return;
        }
        long others = availableSystemAdminCountExcluding(target.getId(), now);
        if (others == 0) {
            throw new BusinessException(ErrorCode.LAST_SYSTEM_ADMIN_REQUIRED, "至少保留一个可用系统管理员");
        }
    }

    public boolean wouldLockLastAvailableSystemAdmin(User target, OffsetDateTime lockedUntil) {
        OffsetDateTime now = OffsetDateTime.now();
        return isAvailableSystemAdmin(target, now)
                && isLocked(lockedUntil, now)
                && availableSystemAdminCountExcluding(target.getId(), now) == 0;
    }

    public boolean isOnlyAvailableSystemAdmin(User target) {
        OffsetDateTime now = OffsetDateTime.now();
        return isAvailableSystemAdmin(target, now) && availableSystemAdminCountExcluding(target.getId(), now) == 0;
    }

    public void ensureDepartmentDisableKeepsSystemAdmin(UUID disabledDepartmentId) {
        OffsetDateTime now = OffsetDateTime.now();
        var systemAdmins = userRepository.lockByRoleAndStatus(Role.SYSTEM_ADMIN, UserStatus.ACTIVE);
        long remaining = systemAdmins.stream()
                .filter(user -> !disabledDepartmentId.equals(user.getDepartmentId()))
                .filter(user -> isAvailableSystemAdmin(user, now))
                .count();
        long affected = systemAdmins.stream()
                .filter(user -> disabledDepartmentId.equals(user.getDepartmentId()))
                .filter(user -> isAvailableSystemAdmin(user, now))
                .count();
        if (affected > 0 && remaining == 0) {
            throw new BusinessException(ErrorCode.LAST_SYSTEM_ADMIN_REQUIRED, "至少保留一个可用系统管理员");
        }
    }

    private long availableSystemAdminCountExcluding(UUID excludedUserId, OffsetDateTime now) {
        return userRepository.lockByRoleAndStatus(Role.SYSTEM_ADMIN, UserStatus.ACTIVE).stream()
                .filter(user -> !user.getId().equals(excludedUserId))
                .filter(user -> isAvailableSystemAdmin(user, now))
                .count();
    }

    private boolean isAvailableSystemAdmin(User user, OffsetDateTime now) {
        return user.isSystemAdmin()
                && user.getStatus() == UserStatus.ACTIVE
                && isDepartmentActive(user.getDepartmentId())
                && !isLocked(user.getLockedUntil(), now);
    }

    private boolean isLocked(OffsetDateTime lockedUntil, OffsetDateTime now) {
        return lockedUntil != null && lockedUntil.isAfter(now);
    }

    private boolean isDepartmentActive(UUID departmentId) {
        return departmentRepository.findById(departmentId)
                .map(department -> department.getStatus() == DepartmentStatus.ACTIVE)
                .orElse(false);
    }
}
