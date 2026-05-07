package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SessionRepository extends JpaRepository<Session, UUID> {
    Optional<Session> findByTokenHash(String tokenHash);
    List<Session> findByUserIdAndRevokedAtIsNull(UUID userId);

    @Modifying
    @Query("update Session s set s.revokedAt = :now, s.revokeReason = :reason where s.userId = :userId and s.revokedAt is null")
    int revokeAllForUser(@Param("userId") UUID userId, @Param("now") OffsetDateTime now, @Param("reason") String reason);

    @Modifying
    @Query("update Session s set s.revokedAt = :now, s.revokeReason = :reason where s.userId = :userId and s.id <> :exceptSessionId and s.revokedAt is null")
    int revokeOtherForUser(@Param("userId") UUID userId, @Param("exceptSessionId") UUID exceptSessionId,
            @Param("now") OffsetDateTime now, @Param("reason") String reason);
}
