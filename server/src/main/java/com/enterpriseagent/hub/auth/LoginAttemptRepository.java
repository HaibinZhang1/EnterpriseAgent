package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface LoginAttemptRepository extends JpaRepository<LoginAttempt, UUID> {
    long countByPhoneAndIpAndResultAndCreatedAtAfter(String phone, String ip, LoginAttemptResult result,
            OffsetDateTime after);
}
