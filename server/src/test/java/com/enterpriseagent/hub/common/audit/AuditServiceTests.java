package com.enterpriseagent.hub.common.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;

class AuditServiceTests extends PostgresIntegrationTestBase {
    @Autowired
    private AuditService auditService;

    @Autowired
    private AuditLogRepository repository;
    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    void writesAuditLogAndRedactsSensitiveFields() {
        AuditLog saved = auditService.record(AuditRecord.builder()
                .requestId("req_audit")
                .objectType("settings")
                .objectId("audit.retention")
                .action("settings.update")
                .result(AuditResult.SUCCESS)
                .reason("foundation test")
                .beforeSummary(Map.of("password", "plain", "safe", "old"))
                .afterSummary(Map.of("apiToken", "secret", "safe", "new"))
                .build());

        AuditLog reloaded = repository.findById(saved.getId()).orElseThrow();
        assertThat(reloaded.getRequestId()).isEqualTo("req_audit");
        assertThat(reloaded.getAfterSummary()).containsEntry("apiToken", "***MASKED***");
        assertThat(reloaded.getAfterSummary()).containsEntry("safe", "new");
    }

    @Test
    void successAuditRollsBackWithBusinessTransaction() {
        TransactionTemplate transactionTemplate = new TransactionTemplate(transactionManager);

        try {
            transactionTemplate.executeWithoutResult(status -> {
                auditService.record(AuditRecord.builder()
                        .requestId("req_audit_rollback")
                        .objectType("settings")
                        .objectId("rollback")
                        .action("audit.rollback.test")
                        .result(AuditResult.SUCCESS)
                        .build());
                throw new IllegalStateException("force rollback");
            });
        } catch (IllegalStateException ignored) {
        }

        assertThat(repository.findAll()).noneMatch(log -> "audit.rollback.test".equals(log.getAction()));
    }

    @Test
    void failureAuditCanCommitIndependentlyFromRejectedBusinessTransaction() {
        TransactionTemplate transactionTemplate = new TransactionTemplate(transactionManager);

        try {
            transactionTemplate.executeWithoutResult(status -> {
                auditService.recordFailure(AuditRecord.builder()
                        .requestId("req_audit_failure_safe")
                        .objectType("permission")
                        .objectId("denied")
                        .action("audit.failure_safe.test")
                        .result(AuditResult.FAILURE)
                        .reason("permission denied")
                        .build());
                throw new IllegalStateException("force rollback");
            });
        } catch (IllegalStateException ignored) {
        }

        assertThat(repository.findAll()).anyMatch(log -> "audit.failure_safe.test".equals(log.getAction()));
    }
}
