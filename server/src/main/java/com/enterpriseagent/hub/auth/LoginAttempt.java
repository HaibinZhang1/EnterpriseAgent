package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "login_attempts")
public class LoginAttempt {
    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 32)
    private String phone;

    @Column(name = "user_id")
    private UUID userId;

    @Column(length = 64)
    private String ip;

    @Column(name = "user_agent", columnDefinition = "text")
    private String userAgent;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private LoginAttemptResult result;

    @Column(name = "failure_reason", length = 128)
    private String failureReason;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected LoginAttempt() {
    }

    public LoginAttempt(String phone, UUID userId, String ip, String userAgent, LoginAttemptResult result,
            String failureReason) {
        this.phone = phone;
        this.userId = userId;
        this.ip = ip;
        this.userAgent = userAgent;
        this.result = result;
        this.failureReason = failureReason;
    }
}
