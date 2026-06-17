import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalEventQueue } from '../src/main/events/local-event-queue';
import { LocalExecutor } from '../src/main/executor/local-executor';
import { LocalKitService, type KitApplicationTargetInput } from '../src/main/lifecycle/local-kit-service';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import {
  AuditStatuses,
  AuthStatuses,
  LocalEventTypes,
  LocalResourceTypes,
  ResourceScopeTypes,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  type KitManifest,
  type ResourceScopeType
} from '../src/shared/local-resources';
import { EnterpriseAuditRuleIds, EnterpriseBlockRuleIds } from '../src/shared/local-audit';
import { tempRoot } from './test-utils';

describe('phase 3 Kit transaction service', () => {
  it('imports a Kit manifest as an unapplied local record without writing agent directories', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const manifest = kitManifest({ kitId: 'kit.imported', resources: [] });

      const result = await context.service.importManifest({ manifest, requestID: 'kit-import-test' });

      expect(result.status).toBe('success');
      expect(context.db.query<{ count: number }>('SELECT COUNT(*) as count FROM local_resources WHERE type = ? AND source_id = ?', [LocalResourceTypes.KIT, 'kit.imported'])[0].count).toBe(1);
      expect(context.db.query<{ count: number }>('SELECT COUNT(*) as count FROM resource_bindings WHERE resource_type = ?', [LocalResourceTypes.KIT])[0].count).toBe(0);
      expect(context.db.query<{ event_type: string; result: string }>('SELECT event_type, result FROM local_events WHERE event_type = ?', [LocalEventTypes.KIT_IMPORTED])[0]).toMatchObject({
        event_type: LocalEventTypes.KIT_IMPORTED,
        result: 'SUCCESS'
      });
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('applies Kit resources with per-resource partial failure and removes only Kit-managed bindings', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const skillPath = path.join(context.paths.root, 'agents', 'codex', 'skills', 'weather');
      await mkdir(skillPath, { recursive: true });
      await context.repo.recordAgentResource({
        resourceType: LocalResourceTypes.SKILL,
        sourceId: 'skill.weather',
        name: 'Weather Skill',
        agentId: 'codex',
        targetPath: skillPath,
        status: 'enabled'
      });
      const skillRow = context.repo.listResources().rows.find((row) => row.resource.sourceId === 'skill.weather');
      expect(skillRow).toBeTruthy();
      const manifest = kitManifest({
        kitId: 'kit.partial',
        resources: [
          {
            refId: 'SKILL:skill.weather',
            resourceType: LocalResourceTypes.SKILL,
            resourceId: skillRow?.resource.id,
            bindingId: skillRow?.binding?.id,
            required: true,
            metadata: {}
          },
          {
            refId: 'MCP_SERVER:mcp.missing',
            resourceType: LocalResourceTypes.MCP_SERVER,
            resourceId: 'resource_missing_mcp',
            required: true,
            metadata: {}
          }
        ]
      });
      await context.service.importManifest({ manifest, requestID: 'kit-partial-import' });

      const applyResult = await context.service.apply({
        kitId: 'kit.partial',
        target: { scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId: 'codex' },
        requestID: 'kit-partial-apply'
      });

      expect(applyResult.status).toBe('partial_success');
      expect(applyResult.planId).toMatch(/^kit_apply_kit\.partial_/);
      expect(applyResult.executionId).toMatch(/^execution_record_/);
      expect(applyResult.resourceResults.map((item) => item.status).sort()).toEqual(['failure', 'success']);
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', [applyResult.planId!])[0].status).toBe('success');
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_records WHERE id = ?', [applyResult.executionId!])[0].status).toBe('success');
      expect(context.db.query<{ result: string }>('SELECT result FROM local_events WHERE event_type = ?', [LocalEventTypes.KIT_APPLIED])[0].result).toBe('PARTIAL_SUCCESS');
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.partial%'")[0].count).toBeGreaterThanOrEqual(2);

      const applicationMetadata = context.db.query<{ metadata_json: string }>(
        "SELECT metadata_json FROM resource_bindings WHERE resource_type = ? AND metadata_json LIKE '%kitApplicationId%'",
        [LocalResourceTypes.KIT]
      )[0];
      const applicationId = JSON.parse(applicationMetadata.metadata_json).kitApplicationId as string;
      const removeResult = await context.service.removeApplication({ kitId: 'kit.partial', applicationId, requestID: 'kit-partial-remove' });

      expect(removeResult.status).toBe('success');
      expect(removeResult.planId).toMatch(/^kit_remove_kit\.partial_/);
      expect(removeResult.executionId).toMatch(/^execution_record_/);
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', [removeResult.planId!])[0].status).toBe('success');
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_records WHERE id = ?', [removeResult.executionId!])[0].status).toBe('success');
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.partial%'")[0].count).toBe(0);
      expect(context.db.query<{ count: number }>('SELECT COUNT(*) as count FROM resource_bindings WHERE resource_id = ?', [skillRow!.resource.id])[0].count).toBe(1);
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps Kit apply and remove dry-runs observable without mutating bindings', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const skillPath = path.join(context.paths.root, 'agents', 'codex', 'skills', 'weather');
      await mkdir(skillPath, { recursive: true });
      await context.repo.recordAgentResource({
        resourceType: LocalResourceTypes.SKILL,
        sourceId: 'skill.dry-run-weather',
        name: 'Weather Skill',
        agentId: 'codex',
        targetPath: skillPath,
        status: 'enabled'
      });
      const skillRow = context.repo.listResources().rows.find((row) => row.resource.sourceId === 'skill.dry-run-weather');
      expect(skillRow).toBeTruthy();
      const manifest = kitManifest({
        kitId: 'kit.dry-run',
        resources: [{
          refId: 'SKILL:skill.dry-run-weather',
          resourceType: LocalResourceTypes.SKILL,
          resourceId: skillRow?.resource.id,
          bindingId: skillRow?.binding?.id,
          required: true,
          metadata: {}
        }]
      });
      await context.service.importManifest({ manifest, requestID: 'kit-dry-run-import' });

      const dryApplyResult = await context.service.apply({
        kitId: 'kit.dry-run',
        target: { scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId: 'codex' },
        requestID: 'kit-dry-run-apply',
        dryRun: true
      });

      expect(dryApplyResult.status).toBe('dry_run');
      expect(dryApplyResult.resourceResults).toHaveLength(1);
      expect(dryApplyResult.resourceResults[0]).toMatchObject({ status: 'dry_run', resourceId: skillRow!.resource.id });
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', [dryApplyResult.planId!])[0].status).toBe('dry_run');
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.dry-run%'")[0].count).toBe(0);

      const applyResult = await context.service.apply({
        kitId: 'kit.dry-run',
        target: { scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId: 'codex' },
        requestID: 'kit-real-apply-before-dry-remove'
      });
      expect(applyResult.status).toBe('success');
      const applicationId = context.db.query<{ metadata_json: string }>(
        "SELECT metadata_json FROM resource_bindings WHERE resource_type = ? AND metadata_json LIKE '%kit.dry-run%'",
        [LocalResourceTypes.KIT]
      ).map((row) => JSON.parse(row.metadata_json).kitApplicationId as string)[0];
      const bindingCountBeforeDryRemove = context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.dry-run%'")[0].count;

      const dryRemoveResult = await context.service.removeApplication({
        kitId: 'kit.dry-run',
        applicationId,
        requestID: 'kit-dry-run-remove',
        dryRun: true
      });

      expect(dryRemoveResult.status).toBe('dry_run');
      expect(dryRemoveResult.resourceResults.every((item) => item.status === 'dry_run')).toBe(true);
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', [dryRemoveResult.planId!])[0].status).toBe('dry_run');
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.dry-run%'")[0].count).toBe(bindingCountBeforeDryRemove);
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('blocks Kit apply for unknown authorization before writing managed bindings', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const skillPath = path.join(context.paths.root, 'agents', 'codex', 'skills', 'unknown-auth');
      await mkdir(skillPath, { recursive: true });
      await context.repo.recordAgentResource({
        resourceType: LocalResourceTypes.SKILL,
        sourceId: 'skill.unknown-auth',
        name: 'Unknown Auth Skill',
        agentId: 'codex',
        targetPath: skillPath,
        status: 'metadata_refresh'
      });
      const skillRow = context.repo.listResources().rows.find((row) => row.resource.sourceId === 'skill.unknown-auth');
      expect(skillRow?.binding?.authStatus).toBe(AuthStatuses.UNKNOWN);
      const manifest = kitManifest({
        kitId: 'kit.unknown-auth',
        resources: [{
          refId: 'SKILL:skill.unknown-auth',
          resourceType: LocalResourceTypes.SKILL,
          resourceId: skillRow?.resource.id,
          bindingId: skillRow?.binding?.id,
          required: true,
          metadata: {}
        }]
      });
      await context.service.importManifest({ manifest, requestID: 'kit-unknown-auth-import' });

      const result = await context.service.apply({
        kitId: 'kit.unknown-auth',
        target: { scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId: 'codex' },
        requestID: 'kit-unknown-auth-apply'
      });

      expect(result.status).toBe('blocked');
      expect(result.policy.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'authorization-not-verified',
          status: 'block',
          errorCode: 'authorization_not_verified'
        })
      ]));
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', [result.planId!])[0].status).toBe('blocked');
      expect(context.db.query<{ result: string }>('SELECT result FROM local_events WHERE event_type = ?', [LocalEventTypes.KIT_APPLIED])[0].result).toBe('BLOCKED');
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.unknown-auth%'")[0].count).toBe(0);
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('rejects invalid Kit scope types before writing bindings', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const manifest = kitManifest({ kitId: 'kit.invalid-scope', resources: [] });
      await context.service.importManifest({ manifest, requestID: 'kit-invalid-scope-import' });

      await expect(context.service.apply({
        kitId: 'kit.invalid-scope',
        target: { scopeType: 'BROKEN_SCOPE' as ResourceScopeType, agentId: 'codex' },
        requestID: 'kit-invalid-scope'
      })).rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.invalid-scope%'")[0].count).toBe(0);
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('rejects incomplete Kit target scopes before ResourceBinding persistence', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const manifest = kitManifest({ kitId: 'kit.bad-target-shape', resources: [] });
      await context.service.importManifest({ manifest, requestID: 'kit-bad-target-import' });
      const invalidTargets: KitApplicationTargetInput[] = [
        { scopeType: ResourceScopeTypes.AGENT_GLOBAL },
        { scopeType: ResourceScopeTypes.PROJECT },
        { scopeType: ResourceScopeTypes.AGENT_PROJECT, agentId: 'codex' },
        { scopeType: ResourceScopeTypes.AGENT_PROJECT, projectId: 'project.alpha' },
        { scopeType: ResourceScopeTypes.CUSTOM_PATH },
        { scopeType: ResourceScopeTypes.GLOBAL, agentId: 'codex' },
        { scopeType: ResourceScopeTypes.KIT, agentId: 'codex' }
      ];

      for (const target of invalidTargets) {
        await expect(context.service.apply({
          kitId: 'kit.bad-target-shape',
          target,
          requestID: `kit-bad-target-${target.scopeType}`
        })).rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      }
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.bad-target-shape%'")[0].count).toBe(0);
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps Kit apply observable when one post-plan binding write fails', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const skillPath = path.join(context.paths.root, 'agents', 'codex', 'skills', 'weather');
      const pluginPath = path.join(context.paths.root, 'agents', 'codex', 'plugins', 'theme');
      await mkdir(skillPath, { recursive: true });
      await mkdir(pluginPath, { recursive: true });
      await context.repo.recordAgentResource({
        resourceType: LocalResourceTypes.SKILL,
        sourceId: 'skill.weather',
        name: 'Weather Skill',
        agentId: 'codex',
        targetPath: skillPath,
        status: 'enabled'
      });
      await context.repo.recordAgentResource({
        resourceType: LocalResourceTypes.PLUGIN,
        sourceId: 'plugin.theme',
        name: 'Theme Plugin',
        agentId: 'codex',
        targetPath: pluginPath,
        status: 'enabled'
      });
      const rows = context.repo.listResources().rows;
      const skillRow = rows.find((row) => row.resource.sourceId === 'skill.weather');
      const pluginRow = rows.find((row) => row.resource.sourceId === 'plugin.theme');
      expect(skillRow).toBeTruthy();
      expect(pluginRow).toBeTruthy();
      const manifest = kitManifest({
        kitId: 'kit.materialization',
        resources: [
          {
            refId: 'SKILL:skill.weather',
            resourceType: LocalResourceTypes.SKILL,
            resourceId: skillRow?.resource.id,
            bindingId: skillRow?.binding?.id,
            required: true,
            metadata: {}
          },
          {
            refId: 'PLUGIN:plugin.theme',
            resourceType: LocalResourceTypes.PLUGIN,
            resourceId: pluginRow?.resource.id,
            bindingId: pluginRow?.binding?.id,
            required: true,
            metadata: {}
          }
        ]
      });
      await context.service.importManifest({ manifest, requestID: 'kit-materialization-import' });
      const original = context.repo.recordKitManagedResourceBinding.bind(context.repo);
      const spy = vi.spyOn(context.repo, 'recordKitManagedResourceBinding').mockImplementation(async (input) => {
        if (input.resourceId === skillRow!.resource.id) throw new Error('forced binding failure');
        return original(input);
      });

      const result = await context.service.apply({
        kitId: 'kit.materialization',
        target: { scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId: 'codex' },
        requestID: 'kit-materialization-apply'
      });

      expect(result.status).toBe('partial_success');
      expect(result.resourceResults.map((item) => item.status).sort()).toEqual(['failure', 'success']);
      expect(result.resourceResults.find((item) => item.resourceId === skillRow!.resource.id)).toMatchObject({
        status: 'failure',
        failureReason: 'forced binding failure'
      });
      expect(result.resourceResults.find((item) => item.resourceId === pluginRow!.resource.id)).toMatchObject({ status: 'success' });
      expect(context.db.query<{ count: number }>("SELECT COUNT(*) as count FROM resource_bindings WHERE metadata_json LIKE '%kit.materialization%'")[0].count).toBeGreaterThanOrEqual(2);
      spy.mockRestore();
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps Kit removal observable when one binding delete fails after the plan succeeds', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const skillPath = path.join(context.paths.root, 'agents', 'codex', 'skills', 'weather');
      const pluginPath = path.join(context.paths.root, 'agents', 'codex', 'plugins', 'theme');
      await mkdir(skillPath, { recursive: true });
      await mkdir(pluginPath, { recursive: true });
      await context.repo.recordAgentResource({
        resourceType: LocalResourceTypes.SKILL,
        sourceId: 'skill.remove.weather',
        name: 'Weather Skill',
        agentId: 'codex',
        targetPath: skillPath,
        status: 'enabled'
      });
      await context.repo.recordAgentResource({
        resourceType: LocalResourceTypes.PLUGIN,
        sourceId: 'plugin.remove.theme',
        name: 'Theme Plugin',
        agentId: 'codex',
        targetPath: pluginPath,
        status: 'enabled'
      });
      const rows = context.repo.listResources().rows;
      const skillRow = rows.find((row) => row.resource.sourceId === 'skill.remove.weather');
      const pluginRow = rows.find((row) => row.resource.sourceId === 'plugin.remove.theme');
      expect(skillRow).toBeTruthy();
      expect(pluginRow).toBeTruthy();
      const manifest = kitManifest({
        kitId: 'kit.remove-materialization',
        resources: [
          {
            refId: 'SKILL:skill.remove.weather',
            resourceType: LocalResourceTypes.SKILL,
            resourceId: skillRow?.resource.id,
            bindingId: skillRow?.binding?.id,
            required: true,
            metadata: {}
          },
          {
            refId: 'PLUGIN:plugin.remove.theme',
            resourceType: LocalResourceTypes.PLUGIN,
            resourceId: pluginRow?.resource.id,
            bindingId: pluginRow?.binding?.id,
            required: true,
            metadata: {}
          }
        ]
      });
      await context.service.importManifest({ manifest, requestID: 'kit-remove-materialization-import' });
      const applyResult = await context.service.apply({
        kitId: 'kit.remove-materialization',
        target: { scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId: 'codex' },
        requestID: 'kit-remove-materialization-apply'
      });
      expect(applyResult.status).toBe('success');
      const applicationId = context.db.query<{ metadata_json: string }>(
        "SELECT metadata_json FROM resource_bindings WHERE resource_type = ? AND metadata_json LIKE '%kit.remove-materialization%'",
        [LocalResourceTypes.KIT]
      ).map((row) => JSON.parse(row.metadata_json).kitApplicationId as string)[0];
      const removable = context.repo.listResources().bindings
        .filter((binding) => binding.metadata.managedByKitId === 'kit.remove-materialization' && binding.resourceType !== LocalResourceTypes.KIT);
      expect(removable).toHaveLength(2);
      const failingBindingId = removable[1].id;
      const original = context.repo.removeKitManagedBinding.bind(context.repo);
      const spy = vi.spyOn(context.repo, 'removeKitManagedBinding').mockImplementation(async (input) => {
        if (input.bindingId === failingBindingId) throw new Error('forced delete failure');
        return original(input);
      });

      const removeResult = await context.service.removeApplication({ kitId: 'kit.remove-materialization', applicationId, requestID: 'kit-remove-materialization-remove' });

      expect(removeResult.status).toBe('partial_success');
      expect(removeResult.resourceResults.map((item) => item.status).sort()).toEqual(['failure', 'success', 'success']);
      expect(removeResult.resourceResults.find((item) => item.bindingId === failingBindingId)).toMatchObject({
        status: 'failure',
        failureReason: 'forced delete failure'
      });
      expect(context.db.query<{ result: string }>('SELECT result FROM local_events WHERE event_type = ? ORDER BY created_at DESC', [LocalEventTypes.KIT_APPLICATION_REMOVED])[0].result).toBe('PARTIAL_SUCCESS');
      spy.mockRestore();
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('exports Kit manifest files through ExecutionPlan and records drift findings without executing local tools', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const manifest = kitManifest({
        kitId: 'kit.export',
        resources: [{
          refId: 'CLI_COMMAND:cli.deploy',
          resourceType: LocalResourceTypes.CLI_COMMAND,
          resourceId: 'resource_cli_missing',
          required: true,
          metadata: { command: 'deploy' }
        }],
        resourceHashes: { 'CLI_COMMAND:cli.deploy': 'expected-hash' }
      });
      await context.service.importManifest({ manifest, requestID: 'kit-export-import' });

      const targetPath = path.join(context.paths.root, 'exports', 'kit-export.json');
      const exportResult = await context.service.exportManifest({ kitId: 'kit.export', targetPath, requestID: 'kit-export-file' });
      expect(exportResult.result?.status).toBe('success');
      expect(await readFile(targetPath, 'utf8')).toContain('kit.export');
      expect(context.db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', [exportResult.plan!.planId])[0].status).toBe('success');

      const driftResult = await context.service.checkDrift({ kitId: 'kit.export', requestID: 'kit-export-drift' });
      expect(driftResult.status).toBe('failure');
      expect(driftResult.resourceResults[0].message).toContain('必需资源缺失');
      expect(context.db.query<{ event_type: string; result: string }>('SELECT event_type, result FROM local_events WHERE event_type = ?', [LocalEventTypes.KIT_DRIFT_CHECKED])[0]).toMatchObject({
        event_type: LocalEventTypes.KIT_DRIFT_CHECKED,
        result: 'FAILURE'
      });
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('runs Kit static audit through the shared audit engine and persists findings', async () => {
    const temp = await tempRoot();
    try {
      const context = await kitContext(temp.root);
      const manifest = kitManifest({
        kitId: 'kit.static-audit',
        resources: [{
          refId: 'HOOK:hook.deploy',
          resourceType: LocalResourceTypes.HOOK,
          resourceId: 'resource_hook_deploy',
          required: true,
          metadata: { command: 'rm -rf /' }
        }],
        metadata: { writeIntent: true, writePath: '../outside/hooks.json' }
      });
      await context.service.importManifest({ manifest, requestID: 'kit-static-audit-import' });

      const auditResult = await context.service.runStaticAudit({ kitId: 'kit.static-audit', requestID: 'kit-static-audit-run' });

      expect(auditResult.status).toBe('failure');
      expect(auditResult.resourceResults[0]).toMatchObject({
        resourceType: LocalResourceTypes.KIT,
        status: 'failure',
        failureReason: 'kit_security_risk'
      });
      expect(auditResult.resourceResults[0].message).toContain('Kit 静态审计完成');
      const persisted = context.db.query<{ rule_id: string; audit_status: string; resource_type: string }>(
        'SELECT rule_id, audit_status, resource_type FROM local_audit_findings WHERE resource_id = ?',
        [`resource_kit_${Buffer.from('kit.static-audit').toString('base64url')}`]
      );
      expect(persisted.map((finding) => finding.rule_id)).toContain(EnterpriseAuditRuleIds.DANGEROUS_COMMANDS);
      expect(persisted.map((finding) => finding.rule_id)).toContain(EnterpriseBlockRuleIds.PATH_TRAVERSAL);
      expect(persisted.some((finding) => finding.audit_status === AuditStatuses.SECURITY_RISK)).toBe(true);
      const event = context.db.query<{ event_type: string; result: string }>(
        'SELECT event_type, result FROM local_events WHERE event_type = ?',
        [LocalEventTypes.KIT_STATIC_AUDITED]
      )[0];
      expect(event).toMatchObject({ event_type: LocalEventTypes.KIT_STATIC_AUDITED, result: 'FAILURE' });
      await context.db.close();
    } finally {
      await temp.cleanup();
    }
  });
});

async function kitContext(root: string) {
  const paths = await initializeAppDataLayout(root);
  const db = new LocalDatabase(paths.localDbFile);
  await db.initialize();
  const repo = new LocalLifecycleRepository(db);
  const eventQueue = new LocalEventQueue(db);
  const localExecutor = new LocalExecutor();
  const service = new LocalKitService({
    db,
    eventQueue,
    lifecycleRepository: repo,
    localExecutor,
    paths,
    getDeviceInfo: async () => ({
      deviceID: 'device-test',
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
      clientVersion: 'test'
    })
  });
  return { paths, db, repo, eventQueue, service };
}

function kitManifest(input: { kitId: string; resources: KitManifest['resources']; resourceHashes?: Record<string, string>; metadata?: Record<string, unknown> }): KitManifest {
  return {
    kitId: input.kitId,
    name: input.kitId,
    version: '1.0.0',
    sourceType: 'imported',
    createdAt: '2026-06-16T00:00:00Z',
    supportedAgents: ['codex'],
    supportedPlatforms: ['macos'],
    resources: input.resources,
    permissionSummary: createEmptyPermissionSummary('Kit 权限汇总'),
    auditSummary: createNotAuditedSummary('Kit 未审计'),
    requiredAuthorizations: input.resources.map((resource) => ({
      resourceId: resource.resourceId ?? resource.refId,
      resourceType: resource.resourceType,
      reason: 'Kit apply',
      requiredStatus: AuthStatuses.AUTH_CACHE_VALID
    })),
    resourceHashes: input.resourceHashes ?? {},
    dependencies: [],
    conflictPolicy: 'skip',
    rollbackPolicy: 'best-effort',
    metadata: input.metadata ?? {}
  };
}
