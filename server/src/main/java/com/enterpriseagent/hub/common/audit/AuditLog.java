package com.enterpriseagent.hub.common.audit;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "audit_logs")
public class AuditLog {
    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "request_id", nullable = false, length = 64)
    private String requestId;

    @Column(name = "actor_id")
    private UUID actorId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "actor_snapshot", columnDefinition = "jsonb")
    private Map<String, Object> actorSnapshot;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "actor_department_snapshot", columnDefinition = "jsonb")
    private Map<String, Object> actorDepartmentSnapshot;

    @Column(name = "object_type", nullable = false, length = 64)
    private String objectType;

    @Column(name = "object_id", length = 128)
    private String objectId;

    @Column(name = "object_name_snapshot", length = 255)
    private String objectNameSnapshot;

    @Column(name = "action", nullable = false, length = 128)
    private String action;

    @Enumerated(EnumType.STRING)
    @Column(name = "result", nullable = false, length = 32)
    private AuditResult result;

    @Column(name = "reason", columnDefinition = "text")
    private String reason;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_summary", columnDefinition = "jsonb")
    private Map<String, Object> beforeSummary;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_summary", columnDefinition = "jsonb")
    private Map<String, Object> afterSummary;

    @Column(name = "ip", length = 64)
    private String ip;

    @Column(name = "user_agent", columnDefinition = "text")
    private String userAgent;

    @Column(name = "client_version", length = 64)
    private String clientVersion;

    @Column(name = "device_id", length = 128)
    private String deviceId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected AuditLog() {
    }

    public AuditLog(AuditRecord record) {
        this.requestId = record.requestId();
        this.actorId = record.actorId();
        this.actorSnapshot = record.actorSnapshot();
        this.actorDepartmentSnapshot = record.actorDepartmentSnapshot();
        this.objectType = record.objectType();
        this.objectId = record.objectId();
        this.objectNameSnapshot = record.objectNameSnapshot();
        this.action = record.action();
        this.result = record.result();
        this.reason = record.reason();
        this.beforeSummary = record.beforeSummary();
        this.afterSummary = record.afterSummary();
        this.ip = record.ip();
        this.userAgent = record.userAgent();
        this.clientVersion = record.clientVersion();
        this.deviceId = record.deviceId();
    }

    public UUID getId() { return id; }
    public String getRequestId() { return requestId; }
    public UUID getActorId() { return actorId; }
    public String getObjectType() { return objectType; }
    public String getObjectId() { return objectId; }
    public String getAction() { return action; }
    public AuditResult getResult() { return result; }
    public Map<String, Object> getBeforeSummary() { return beforeSummary; }
    public Map<String, Object> getAfterSummary() { return afterSummary; }
}
