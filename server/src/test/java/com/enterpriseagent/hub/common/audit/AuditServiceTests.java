package com.enterpriseagent.hub.common.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;

class AuditServiceTests extends PostgresIntegrationTestBase {
    @Autowired
    private AuditService auditService;

    @Autowired
    private AuditLogRepository repository;

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
}
