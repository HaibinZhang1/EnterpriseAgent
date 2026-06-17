import { describe, expect, it } from 'vitest';
import {
  AuditSeverities,
  EnterpriseAuditRuleIds,
  EnterpriseBlockRuleIds,
  allAuditRuleDefinitions,
  auditRules,
  calculateTrustScore,
  enterpriseBlockRules,
  mapTrustScoreToAuditStatus,
  phase4AcceptanceCoverage,
  severityDeductions,
  summarizeAuditFindings,
  type AuditFindingRecord,
  type AuditSeverity
} from '../src/shared/local-audit';
import { AuditStatuses, LocalResourceTypes, PermissionCategories } from '../src/shared/local-resources';

function scoreFinding(ruleId: string, severity: AuditSeverity, blocker = false): Pick<AuditFindingRecord, 'ruleId' | 'severity' | 'blocker'> {
  return { ruleId, severity, blocker };
}

describe('phase-four local audit rule registry', () => {
  it('registers the canonical EnterpriseAgent audit and blocker IDs exactly once', () => {
    expect(auditRules.map((rule) => rule.id)).toEqual(Object.values(EnterpriseAuditRuleIds));
    expect(enterpriseBlockRules.map((rule) => rule.id)).toEqual(Object.values(EnterpriseBlockRuleIds));
    expect(new Set(allAuditRuleDefinitions.map((rule) => rule.id)).size).toBe(allAuditRuleDefinitions.length);
  });

  it('keeps HarnessKit mapping and executable remediation metadata on every audit rule', () => {
    for (const rule of auditRules) {
      expect(rule.harnessRuleId).toMatch(/^[a-z0-9-]+$/);
      expect(rule.description.length).toBeGreaterThan(12);
      expect(rule.remediation.length).toBeGreaterThan(12);
      expect(rule.applicableResourceTypes.length).toBeGreaterThan(0);
      expect(rule.permissionCategory).toBeTruthy();
      expect(rule.deduction).toBe(severityDeductions[rule.severity]);
      expect(rule.blocker).toBe(false);
    }
    for (const rule of enterpriseBlockRules) {
      expect(rule.blocker).toBe(true);
      expect(rule.deduction).toBe(100);
      expect(rule.severity).toBe(AuditSeverities.CRITICAL);
    }
  });

  it('uses HarnessKit-style first-hit and repeated-hit scoring', () => {
    expect(calculateTrustScore([scoreFinding('critical', AuditSeverities.CRITICAL)])).toBe(75);
    expect(calculateTrustScore([scoreFinding('high', AuditSeverities.HIGH)])).toBe(85);
    expect(calculateTrustScore([scoreFinding('medium', AuditSeverities.MEDIUM)])).toBe(92);
    expect(calculateTrustScore([scoreFinding('low', AuditSeverities.LOW)])).toBe(97);
    expect(calculateTrustScore([
      scoreFinding('same-rule', AuditSeverities.CRITICAL),
      scoreFinding('same-rule', AuditSeverities.CRITICAL),
      scoreFinding('same-rule', AuditSeverities.CRITICAL)
    ])).toBe(73);
    expect(calculateTrustScore(Array.from({ length: 5 }, (_, index) => scoreFinding(`critical-${index}`, AuditSeverities.CRITICAL)))).toBe(0);
  });

  it('maps Trust Score to EnterpriseAgent audit statuses with blocker priority', () => {
    expect(mapTrustScoreToAuditStatus(undefined, { audited: false })).toBe(AuditStatuses.NOT_AUDITED);
    expect(mapTrustScoreToAuditStatus(100)).toBe(AuditStatuses.SAFE);
    expect(mapTrustScoreToAuditStatus(80)).toBe(AuditStatuses.SAFE);
    expect(mapTrustScoreToAuditStatus(79)).toBe(AuditStatuses.LOW_RISK);
    expect(mapTrustScoreToAuditStatus(60)).toBe(AuditStatuses.LOW_RISK);
    expect(mapTrustScoreToAuditStatus(59)).toBe(AuditStatuses.NEEDS_REVIEW);
    expect(mapTrustScoreToAuditStatus(40)).toBe(AuditStatuses.NEEDS_REVIEW);
    expect(mapTrustScoreToAuditStatus(39)).toBe(AuditStatuses.HIGH_RISK);
    expect(mapTrustScoreToAuditStatus(1)).toBe(AuditStatuses.HIGH_RISK);
    expect(mapTrustScoreToAuditStatus(0)).toBe(AuditStatuses.SECURITY_RISK);
    expect(mapTrustScoreToAuditStatus(88, { hasBlocker: true })).toBe(AuditStatuses.SECURITY_RISK);
    expect(calculateTrustScore([scoreFinding(EnterpriseBlockRuleIds.HASH_MISMATCH, AuditSeverities.CRITICAL, true)])).toBe(0);
  });

  it('summarizes structured findings without losing severity counts', () => {
    const summary = summarizeAuditFindings([
      finding(EnterpriseAuditRuleIds.RCE, AuditSeverities.CRITICAL),
      finding(EnterpriseAuditRuleIds.DANGEROUS_COMMANDS, AuditSeverities.HIGH)
    ], '2026-06-16T00:00:00.000Z');
    expect(summary).toMatchObject({
      status: AuditStatuses.LOW_RISK,
      trustScore: 60,
      findingCount: 2,
      criticalCount: 1,
      highCount: 1,
      lastAuditedAt: '2026-06-16T00:00:00.000Z'
    });
  });

  it('maps the user acceptance categories onto canonical rules or blockers', () => {
    expect(Object.keys(phase4AcceptanceCoverage)).toHaveLength(18);
    const expectedCategories = [
      'sensitive-file-path-access',
      'broad-project-directory-read-write',
      'path-traversal-absolute-write',
      'destructive-file-command',
      'shell-injection',
      'unauthorized-command-path',
      'external-network-domain',
      'plaintext-http-insecure-endpoint',
      'env-var-read',
      'sensitive-env-var-read',
      'hardcoded-secret',
      'database-connection-string',
      'mcp-required-variable-missing',
      'mcp-sensitive-variable-plaintext',
      'plugin-package-hash-abnormal',
      'subagent-nonexistent-reference',
      'hook-auto-trigger-high-risk-command',
      'config-drift-external-modification'
    ];
    for (const category of expectedCategories) {
      expect(phase4AcceptanceCoverage[category]?.length).toBeGreaterThan(0);
      for (const ruleId of phase4AcceptanceCoverage[category] ?? []) {
        expect(allAuditRuleDefinitions.some((rule) => rule.id === ruleId)).toBe(true);
      }
    }
  });
});

function finding(ruleId: string, severity: AuditSeverity): AuditFindingRecord {
  return {
    id: `finding_${ruleId}`,
    runId: 'run_1',
    ruleId,
    resourceId: 'resource_1',
    resourceType: LocalResourceTypes.SKILL,
    severity,
    auditStatus: AuditStatuses.NEEDS_REVIEW,
    trustScoreImpact: severityDeductions[severity],
    permissionCategory: PermissionCategories.SHELL,
    title: ruleId,
    description: ruleId,
    impactScope: {},
    remediation: 'review',
    relatedEventIds: [],
    metadata: {},
    detectedAt: '2026-06-16T00:00:00.000Z',
    blocker: false
  };
}
