package com.enterpriseagent.hub.auth;

import org.springframework.stereotype.Service;

@Service
public class PermissionService {
    public boolean canUseAdminWeb(User user) {
        return user.getRole() == Role.DEPARTMENT_ADMIN || user.getRole() == Role.SYSTEM_ADMIN;
    }

    public boolean canUseDesktop(User user) {
        return user.getStatus() == UserStatus.ACTIVE;
    }
}
