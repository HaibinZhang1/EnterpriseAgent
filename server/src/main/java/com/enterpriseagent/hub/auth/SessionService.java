package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.organization.Department;
import com.enterpriseagent.hub.organization.DepartmentRepository;
import com.enterpriseagent.hub.organization.DepartmentStatus;

@Service
public class SessionService {
    private final SessionRepository sessionRepository;
    private final UserRepository userRepository;
    private final DepartmentRepository departmentRepository;
    private final TokenService tokenService;
    private final AuthProperties properties;

    public SessionService(SessionRepository sessionRepository, UserRepository userRepository,
            DepartmentRepository departmentRepository, TokenService tokenService, AuthProperties properties) {
        this.sessionRepository = sessionRepository;
        this.userRepository = userRepository;
        this.departmentRepository = departmentRepository;
        this.tokenService = tokenService;
        this.properties = properties;
    }

    @Transactional
    public CreatedSession create(User user, ClientType clientType, String deviceId) {
        OffsetDateTime now = OffsetDateTime.now();
        String token = tokenService.newToken();
        OffsetDateTime expiresAt = now.plus(clientType == ClientType.ADMIN_WEB
                ? properties.adminSessionTtl()
                : properties.desktopSessionTtl());
        OffsetDateTime idleExpiresAt = clientType == ClientType.ADMIN_WEB ? now.plus(properties.adminIdleTtl()) : null;
        Session session = sessionRepository.save(new Session(user.getId(), deviceId, tokenService.hash(token), clientType,
                expiresAt, idleExpiresAt));
        return new CreatedSession(token, session);
    }

    @Transactional
    public CurrentUser authenticate(String token, String ip, String userAgent, String clientVersion) {
        OffsetDateTime now = OffsetDateTime.now();
        Session session = sessionRepository.findByTokenHash(tokenService.hash(token))
                .orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHENTICATED, "未登录或会话已失效"));
        if (session.isRevoked() || !session.getExpiresAt().isAfter(now)
                || (session.getIdleExpiresAt() != null && !session.getIdleExpiresAt().isAfter(now))) {
            if (!session.isRevoked()) {
                session.revoke("expired");
            }
            throw new BusinessException(ErrorCode.UNAUTHENTICATED, "未登录或会话已失效");
        }
        User user = userRepository.findByIdAndStatusNot(session.getUserId(), UserStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHENTICATED, "未登录或会话已失效"));
        Department department = departmentRepository.findByIdAndStatusNot(user.getDepartmentId(), DepartmentStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.UNAUTHENTICATED, "未登录或会话已失效"));
        if (user.getStatus() != UserStatus.ACTIVE || department.getStatus() != DepartmentStatus.ACTIVE) {
            session.revoke("principal_state_changed");
            throw new BusinessException(ErrorCode.UNAUTHENTICATED, "未登录或会话已失效");
        }
        session.setLastAccessedAt(now);
        if (session.getClientType() == ClientType.ADMIN_WEB) {
            OffsetDateTime nextIdleExpiry = now.plus(properties.adminIdleTtl());
            session.setIdleExpiresAt(nextIdleExpiry.isBefore(session.getExpiresAt()) ? nextIdleExpiry : session.getExpiresAt());
        }
        return new CurrentUser(user.getId(), user.getName(), user.getPhone(), user.getRole(), user.getDepartmentId(),
                department.getName(), department.getStatus(), session.getId(), session.getClientType(), session.getDeviceId(),
                clientVersion, ip, userAgent);
    }

    @Transactional
    public void revoke(UUID sessionId, String reason) {
        sessionRepository.findById(sessionId).ifPresent(session -> session.revoke(reason));
    }

    @Transactional
    public void revokeAllForUser(UUID userId, String reason) {
        sessionRepository.revokeAllForUser(userId, OffsetDateTime.now(), reason);
    }

    @Transactional
    public void revokeOtherForUser(UUID userId, UUID exceptSessionId, String reason) {
        sessionRepository.revokeOtherForUser(userId, exceptSessionId, OffsetDateTime.now(), reason);
    }

    public record CreatedSession(String token, Session session) {
    }
}
