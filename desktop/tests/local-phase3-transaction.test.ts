import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalEventQueue } from '../src/main/events/local-event-queue';
import { LocalExecutor } from '../src/main/executor/local-executor';
import type { ExecutionPlan } from '../src/main/executor/types';
import { createPhase3MetadataPlan, Phase3MetadataOperationRunner } from '../src/main/lifecycle/phase3-metadata-operation-runner';
import { createPhase3OperationPolicyDecision } from '../src/shared/local-phase3-operations';
import { AuthStatuses, LocalResourceTypes } from '../src/shared/local-resources';
import { tempRoot } from './test-utils';

describe('phase 3 transaction chain', () => {
  it('persists execution records and resource-aware LocalEvent context for file/config plans', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const eventQueue = new LocalEventQueue(db);
      const target = path.join(paths.tempDir, 'managed-config.json');
      const plan: ExecutionPlan = {
        planId: 'phase3-file-plan',
        operation: 'PHASE3_FILE_WRITE',
        extensionId: 'plugin.alpha',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        dryRun: false,
        riskLevel: 'LOW',
        summary: { title: 'phase3 file write', description: 'write managed config', targetCount: 1, warnings: [] },
        preconditions: [],
        steps: [{
          stepId: 'write',
          action: 'write-file',
          description: 'write',
          targetPath: target,
          content: '{"ok":true}',
          rollbackable: true,
          managed: true,
          metadata: {
            resourceId: 'resource_plugin_alpha',
            bindingId: 'binding_plugin_alpha_codex',
            resourceType: LocalResourceTypes.PLUGIN,
            agentId: 'codex',
            projectId: 'project.alpha',
            kitId: 'kit.alpha'
          }
        }],
        rollbackPolicy: { strategy: 'best-effort' },
        idempotencyKey: 'phase3-file-plan-key'
      };

      const result = await new LocalExecutor().execute(plan, {
        allowedRoots: [paths.root],
        backupRoot: paths.backupsDir,
        db,
        eventQueue,
        deviceID: 'device-test'
      });

      expect(result.status).toBe('success');
      expect(await readFile(target, 'utf8')).toBe('{"ok":true}');
      const record = db.query<{ id: string; status: string }>('SELECT id, status FROM execution_records WHERE plan_id = ?', [plan.planId])[0];
      expect(record.status).toBe('success');
      const event = db.query<{ operation_id: string; execution_id: string; resource_id: string; binding_id: string; project_id: string; kit_id: string }>(
        'SELECT operation_id, execution_id, resource_id, binding_id, project_id, kit_id FROM local_events WHERE idempotency_key = ?',
        [`${plan.idempotencyKey}:success`]
      )[0];
      expect(event.operation_id).toBe(plan.planId);
      expect(event.execution_id).toBe(record.id);
      expect(event.resource_id).toBe('resource_plugin_alpha');
      expect(event.binding_id).toBe('binding_plugin_alpha_codex');
      expect(event.project_id).toBe('project.alpha');
      expect(event.kit_id).toBe('kit.alpha');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('records file/config dry-runs through execution records and LocalEvent without writing files', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const eventQueue = new LocalEventQueue(db);
      const target = path.join(paths.tempDir, 'dry-run-config.json');
      const plan: ExecutionPlan = {
        planId: 'phase3-file-dry-run',
        operation: 'PHASE3_FILE_DRY_RUN',
        createdAt: new Date().toISOString(),
        dryRun: true,
        riskLevel: 'LOW',
        summary: { title: 'phase3 file dry run', description: 'dry-run managed config', targetCount: 1, warnings: [] },
        preconditions: [],
        steps: [{
          stepId: 'write',
          action: 'write-file',
          description: 'write',
          targetPath: target,
          content: '{"ok":true}',
          rollbackable: true,
          managed: true,
          metadata: {
            resourceId: 'resource_plugin_dry_run',
            resourceType: LocalResourceTypes.PLUGIN,
            agentId: 'codex'
          }
        }],
        rollbackPolicy: { strategy: 'best-effort' },
        idempotencyKey: 'phase3-file-dry-run-key'
      };

      const result = await new LocalExecutor().execute(plan, {
        allowedRoots: [paths.root],
        backupRoot: paths.backupsDir,
        db,
        eventQueue,
        deviceID: 'device-test'
      });

      expect(result.status).toBe('dry_run');
      await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE plan_id = ?', [plan.planId])[0].status).toBe('dry_run');
      const event = db.query<{ result: string; resource_id: string }>(
        'SELECT result, resource_id FROM local_events WHERE idempotency_key = ?',
        [`${plan.idempotencyKey}:dry_run`]
      )[0];
      expect(event).toMatchObject({ result: 'DRY_RUN', resource_id: 'resource_plugin_dry_run' });
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('records metadata-only operations through plan, execution record, and LocalEvent without filesystem writes', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const eventQueue = new LocalEventQueue(db);
      const policy = createPhase3OperationPolicyDecision({
        surface: 'toolkits',
        operation: 'kit.import',
        resources: [{ resourceId: 'resource_kit_alpha', resourceType: LocalResourceTypes.KIT, authStatus: AuthStatuses.UNKNOWN }]
      });
      const plan = createPhase3MetadataPlan({
        planId: 'phase3-kit-import',
        operation: 'KIT_IMPORT',
        summaryTitle: 'Import Kit manifest',
        summaryDescription: 'Record imported Kit manifest as unapplied local metadata',
        idempotencyKey: 'phase3-kit-import-key'
      });
      const runner = new Phase3MetadataOperationRunner({ db, eventQueue, deviceID: 'device-test' });
      const result = await runner.execute({
        plan,
        policy,
        apply: async () => {
          await db.run(
            `INSERT INTO local_resources(id, type, name, display_name, source_type, source_id, managed, central_store_managed,
              native_directory_managed, ea_managed_fallback, permission_summary_json, audit_summary_json, metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '{}', '{}', ?, ?)`,
            ['resource_kit_alpha', LocalResourceTypes.KIT, 'Alpha Kit', 'Alpha Kit', 'LOCAL_IMPORT', 'kit.alpha', '{"applied":false}', new Date().toISOString()]
          );
          return [{ resourceId: 'resource_kit_alpha', resourceType: LocalResourceTypes.KIT, status: 'success', message: 'Kit manifest imported as unapplied metadata.' }];
        }
      });

      expect(result.status).toBe('success');
      expect(result.executionId).toMatch(/^execution_record_/);
      expect(db.query<{ count: number }>('SELECT COUNT(*) as count FROM execution_plans WHERE id = ?', [plan.planId])[0].count).toBe(1);
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE plan_id = ?', [plan.planId])[0].status).toBe('success');
      const event = db.query<{ operation_id: string; execution_id: string; result: string; resource_id: string }>(
        'SELECT operation_id, execution_id, result, resource_id FROM local_events WHERE idempotency_key = ?',
        [`${plan.idempotencyKey}:success`]
      )[0];
      expect(event.operation_id).toBe(plan.planId);
      expect(event.execution_id).toBe(result.executionId);
      expect(event.result).toBe('SUCCESS');
      expect(event.resource_id).toBe('resource_kit_alpha');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('records metadata-only dry-runs through plan, execution record, and LocalEvent', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const eventQueue = new LocalEventQueue(db);
      const policy = createPhase3OperationPolicyDecision({
        surface: 'toolkits',
        operation: 'kit.import',
        resources: [{ resourceId: 'resource_kit_dry_run', resourceType: LocalResourceTypes.KIT, authStatus: AuthStatuses.UNKNOWN }]
      });
      const plan = createPhase3MetadataPlan({
        planId: 'phase3-kit-import-dry-run',
        operation: 'KIT_IMPORT_DRY_RUN',
        summaryTitle: 'Import Kit manifest dry run',
        summaryDescription: 'Record dry-run event for imported Kit manifest',
        idempotencyKey: 'phase3-kit-import-dry-run-key',
        dryRun: true
      });
      const runner = new Phase3MetadataOperationRunner({ db, eventQueue, deviceID: 'device-test' });
      const result = await runner.execute({
        plan,
        policy,
        resourceResults: [{
          resourceId: 'resource_kit_dry_run',
          resourceType: LocalResourceTypes.KIT,
          status: 'dry_run',
          message: 'Kit import dry run.'
        }]
      });

      expect(result.status).toBe('dry_run');
      expect(result.eventIds).toHaveLength(1);
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE plan_id = ?', [plan.planId])[0].status).toBe('dry_run');
      const event = db.query<{ result: string; resource_id: string }>(
        'SELECT result, resource_id FROM local_events WHERE idempotency_key = ?',
        [`${plan.idempotencyKey}:dry_run`]
      )[0];
      expect(event).toMatchObject({ result: 'DRY_RUN', resource_id: 'resource_kit_dry_run' });
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('records rollback failures as rollback_failed execution records and LocalEvent results', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const eventQueue = new LocalEventQueue(db);
      const managedDir = path.join(paths.tempDir, 'managed-config');
      const target = path.join(managedDir, 'settings.json');
      await mkdir(managedDir, { recursive: true });
      await writeFile(target, '{"before":true}', 'utf8');

      const plan: ExecutionPlan = {
        planId: 'phase4-rollback-failed',
        operation: 'PHASE4_FILE_WRITE',
        createdAt: new Date().toISOString(),
        dryRun: false,
        riskLevel: 'HIGH',
        summary: { title: 'phase4 rollback failed', description: 'write then fail after parent removal', targetCount: 1, warnings: [] },
        preconditions: [],
        steps: [{
          stepId: 'write',
          action: 'write-file',
          description: 'write managed config',
          targetPath: target,
          content: '{"after":true}',
          rollbackable: true,
          managed: true,
          metadata: {
            resourceId: 'resource_settings_alpha',
            bindingId: 'binding_settings_alpha_codex',
            resourceType: LocalResourceTypes.AGENT_CONFIG,
            agentId: 'codex',
            projectId: 'project.alpha'
          }
        }, {
          stepId: 'remove-parent',
          action: 'remove-managed',
          description: 'remove parent without rollback support',
          targetPath: managedDir,
          rollbackable: false,
          managed: true,
          riskLevel: 'HIGH'
        }, {
          stepId: 'block-parent-path',
          action: 'write-file',
          description: 'replace parent directory with a file',
          targetPath: managedDir,
          content: 'parent path is blocked',
          rollbackable: false,
          managed: true,
          riskLevel: 'HIGH'
        }, {
          stepId: 'bad-copy',
          action: 'copy-file',
          description: 'copy missing source',
          sourcePath: path.join(paths.tempDir, 'missing.json'),
          targetPath: path.join(paths.tempDir, 'after.json'),
          rollbackable: true,
          managed: true
        }],
        rollbackPolicy: { strategy: 'best-effort' },
        idempotencyKey: 'phase4-rollback-failed-key'
      };

      const result = await new LocalExecutor().execute(plan, {
        allowedRoots: [paths.root],
        managedPaths: [managedDir],
        backupRoot: paths.backupsDir,
        db,
        eventQueue,
        deviceID: 'device-test'
      });

      expect(result.status).toBe('rollback_failed');
      expect(result.steps.at(-1)).toMatchObject({ stepId: 'bad-copy', status: 'failed', rollbackStatus: 'failed' });
      await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOTDIR' });
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE plan_id = ?', [plan.planId])[0].status).toBe('rollback_failed');
      const event = db.query<{ result: string; resource_id: string; binding_id: string }>(
        'SELECT result, resource_id, binding_id FROM local_events WHERE idempotency_key = ?',
        [`${plan.idempotencyKey}:rollback_failed`]
      )[0];
      expect(event).toMatchObject({
        result: 'ROLLBACK_FAILED',
        resource_id: 'resource_settings_alpha',
        binding_id: 'binding_settings_alpha_codex'
      });
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('returns and records failure when metadata-only apply fails', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const eventQueue = new LocalEventQueue(db);
      const policy = createPhase3OperationPolicyDecision({
        surface: 'projects',
        operation: 'project.remove-record',
        resources: [{ resourceId: 'resource_project_alpha', resourceType: LocalResourceTypes.PROJECT }]
      });
      const plan = createPhase3MetadataPlan({
        planId: 'phase3-project-remove',
        operation: 'PROJECT_REMOVE_RECORD',
        summaryTitle: 'Remove project management record',
        summaryDescription: 'Remove only the local project management record',
        idempotencyKey: 'phase3-project-remove-key'
      });
      const runner = new Phase3MetadataOperationRunner({ db, eventQueue, deviceID: 'device-test' });
      const result = await runner.execute({
        plan,
        policy,
        apply: async () => {
          throw new Error('associated resources remain');
        }
      });

      expect(result.status).toBe('failure');
      expect(result.failureReason).toBe('associated resources remain');
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE plan_id = ?', [plan.planId])[0].status).toBe('failure');
      const event = db.query<{ result: string; failure_reason: string }>(
        'SELECT result, failure_reason FROM local_events WHERE idempotency_key = ?',
        [`${plan.idempotencyKey}:failure`]
      )[0];
      expect(event.result).toBe('FAILURE');
      expect(event.failure_reason).toBe('associated resources remain');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
