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
@Table(name = "sessions")
public class Session {
    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "device_id", length = 128)
    private String deviceId;

    @Column(name = "token_hash", nullable = false, length = 255)
    private String tokenHash;

    @Enumerated(EnumType.STRING)
    @Column(name = "client_type", nullable = false, length = 32)
    private ClientType clientType;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "idle_expires_at")
    private OffsetDateTime idleExpiresAt;

    @Column(name = "revoked_at")
    private OffsetDateTime revokedAt;

    @Column(name = "revoke_reason", length = 128)
    private String revokeReason;

    @Column(name = "last_accessed_at", nullable = false)
    private OffsetDateTime lastAccessedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected Session() {
    }

    public Session(UUID userId, String deviceId, String tokenHash, ClientType clientType, OffsetDateTime expiresAt,
            OffsetDateTime idleExpiresAt) {
        this.userId = userId;
        this.deviceId = deviceId;
        this.tokenHash = tokenHash;
        this.clientType = clientType;
        this.expiresAt = expiresAt;
        this.idleExpiresAt = idleExpiresAt;
        this.lastAccessedAt = OffsetDateTime.now();
    }

    public boolean isRevoked() { return revokedAt != null; }
    public void revoke(String reason) { this.revokedAt = OffsetDateTime.now(); this.revokeReason = reason; }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getDeviceId() { return deviceId; }
    public String getTokenHash() { return tokenHash; }
    public ClientType getClientType() { return clientType; }
    public OffsetDateTime getExpiresAt() { return expiresAt; }
    public OffsetDateTime getIdleExpiresAt() { return idleExpiresAt; }
    public OffsetDateTime getRevokedAt() { return revokedAt; }
    public String getRevokeReason() { return revokeReason; }
    public OffsetDateTime getLastAccessedAt() { return lastAccessedAt; }
    public void setLastAccessedAt(OffsetDateTime lastAccessedAt) { this.lastAccessedAt = lastAccessedAt; }
    public void setIdleExpiresAt(OffsetDateTime idleExpiresAt) { this.idleExpiresAt = idleExpiresAt; }
}
