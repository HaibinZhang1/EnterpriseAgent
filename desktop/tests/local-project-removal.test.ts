import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { LocalEventTypes, LocalResourceTypes } from '../src/shared/local-resources';
import { tempRoot } from './test-utils';

describe('phase 3 project removal protection', () => {
  it('blocks project management record removal while project-scoped resources remain', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      const projectDir = path.join(temp.root, 'project-alpha');
      await mkdir(path.join(projectDir, '.codex', 'skills'), { recursive: true });
      await repo.recordScannedProject({ projectId: 'project.alpha', name: 'Alpha Project', metadata: { target: projectDir } });
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.SKILL,
        sourceId: 'skill.weather',
        name: 'Weather Skill',
        agentId: 'codex',
        projectId: 'project.alpha',
        targetPath: path.join(projectDir, '.codex', 'skills', 'weather'),
        status: 'enabled'
      });

      const validation = repo.validateProjectRemoval('project.alpha');
      expect(validation.allowed).toBe(false);
      expect(validation.blockers).toHaveLength(1);
      expect(validation.cleanupGuidance).toContain('先停用');

      const result = await repo.removeProjectManagementRecord({ projectId: 'project.alpha', operationId: 'project-remove-plan', executionId: 'execution-project-remove' });
      expect(result.removed).toBe(false);
      expect(result.planId).toBe('project-remove-plan');
      expect(result.executionId).toBe('execution-project-remove');
      expect(db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', ['project-remove-plan'])[0].status).toBe('blocked');
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE id = ?', ['execution-project-remove'])[0].status).toBe('blocked');
      expect(await stat(projectDir)).toMatchObject({ isDirectory: expect.any(Function) });
      expect(db.query<{ event_type: string; operation_id: string; execution_id: string }>(
        `SELECT event_type, operation_id, execution_id FROM local_events WHERE event_type = ?`,
        [LocalEventTypes.PROJECT_RECORD_REMOVAL_BLOCKED]
      )[0]).toMatchObject({ operation_id: 'project-remove-plan', execution_id: 'execution-project-remove' });
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('blocks project management record removal while project-scoped settings remain', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      const projectDir = path.join(temp.root, 'project-settings');
      await mkdir(path.join(projectDir, '.codex'), { recursive: true });
      await repo.recordScannedProject({ projectId: 'project.settings', name: 'Settings Project', metadata: { target: projectDir } });
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.AGENT_CONFIG,
        sourceId: 'codex:settings:project-settings',
        name: 'Codex Project Settings',
        agentId: 'codex',
        projectId: 'project.settings',
        targetPath: path.join(projectDir, '.codex', 'config.toml'),
        status: 'scanned'
      });

      const validation = repo.validateProjectRemoval('project.settings');
      expect(validation.allowed).toBe(false);
      expect(validation.blockers).toHaveLength(1);
      expect(validation.blockers[0]).toMatchObject({ resourceType: LocalResourceTypes.AGENT_CONFIG, agentId: 'codex' });

      const result = await repo.removeProjectManagementRecord({ projectId: 'project.settings' });
      expect(result.removed).toBe(false);
      expect(result.validation.blockers[0]).toMatchObject({ resourceType: LocalResourceTypes.AGENT_CONFIG });
      expect(await stat(projectDir)).toMatchObject({ isDirectory: expect.any(Function) });
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('removes only the local project management record when no associations remain', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      const projectDir = path.join(temp.root, 'project-beta');
      await mkdir(projectDir, { recursive: true });
      await repo.recordScannedProject({ projectId: 'project.beta', name: 'Beta Project', metadata: { target: projectDir } });

      const result = await repo.removeProjectManagementRecord({ projectId: 'project.beta', operationId: 'project-remove-beta', executionId: 'execution-project-beta' });
      expect(result.removed).toBe(true);
      expect(result.planId).toBe('project-remove-beta');
      expect(result.executionId).toBe('execution-project-beta');
      expect(db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', ['project-remove-beta'])[0].status).toBe('success');
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE id = ?', ['execution-project-beta'])[0].status).toBe('success');
      expect(await stat(projectDir)).toMatchObject({ isDirectory: expect.any(Function) });
      expect(db.query<{ count: number }>('SELECT COUNT(*) as count FROM local_projects WHERE project_id = ?', ['project.beta'])[0].count).toBe(0);
      expect(db.query<{ count: number }>('SELECT COUNT(*) as count FROM local_resources WHERE type = ? AND source_id = ?', [LocalResourceTypes.PROJECT, 'project.beta'])[0].count).toBe(0);
      expect(db.query<{ event_type: string }>(
        `SELECT event_type FROM local_events WHERE event_type = ?`,
        [LocalEventTypes.PROJECT_RECORD_REMOVED]
      )[0]).toMatchObject({ event_type: LocalEventTypes.PROJECT_RECORD_REMOVED });
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('blocks unknown project record removal instead of reporting fake success', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);

      const validation = repo.validateProjectRemoval('project.missing');
      expect(validation.exists).toBe(false);
      expect(validation.allowed).toBe(false);
      expect(validation.cleanupGuidance).toContain('未找到');

      const result = await repo.removeProjectManagementRecord({
        projectId: 'project.missing',
        operationId: 'project-remove-missing',
        executionId: 'execution-project-missing'
      });

      expect(result.removed).toBe(false);
      expect(result.validation.exists).toBe(false);
      expect(db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', ['project-remove-missing'])[0].status).toBe('blocked');
      expect(db.query<{ status: string; result_json: string }>('SELECT status, result_json FROM execution_records WHERE id = ?', ['execution-project-missing'])[0]).toMatchObject({ status: 'blocked' });
      const blockedEvent = db.query<{ event_type: string; result: string; error_code: string }>(
        `SELECT event_type, result, error_code FROM local_events WHERE event_type = ?`,
        [LocalEventTypes.PROJECT_RECORD_REMOVAL_BLOCKED]
      )[0];
      expect(blockedEvent).toMatchObject({
        event_type: LocalEventTypes.PROJECT_RECORD_REMOVAL_BLOCKED,
        result: 'failure',
        error_code: 'project_record_not_found'
      });
      expect(db.query<{ count: number }>('SELECT COUNT(*) as count FROM local_events WHERE event_type = ?', [LocalEventTypes.PROJECT_RECORD_REMOVED])[0].count).toBe(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('rolls back local project record deletion when the DB transaction fails', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      const projectDir = path.join(temp.root, 'project-gamma');
      await mkdir(projectDir, { recursive: true });
      await repo.recordScannedProject({ projectId: 'project.gamma', name: 'Gamma Project', metadata: { target: projectDir } });
      const originalTransaction = db.transaction.bind(db);
      const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(async (work) => originalTransaction(async (tx) => work({
        query: tx.query,
        run: (sql, params) => {
          tx.run(sql, params);
          if (sql.includes('DELETE FROM local_projects')) throw new Error('forced project removal transaction failure');
        }
      })));

      await expect(repo.removeProjectManagementRecord({
        projectId: 'project.gamma',
        operationId: 'project-remove-gamma',
        executionId: 'execution-project-gamma'
      })).rejects.toThrow('forced project removal transaction failure');

      expect(db.query<{ count: number }>('SELECT COUNT(*) as count FROM local_projects WHERE project_id = ?', ['project.gamma'])[0].count).toBe(1);
      expect(db.query<{ count: number }>('SELECT COUNT(*) as count FROM local_resources WHERE type = ? AND source_id = ?', [LocalResourceTypes.PROJECT, 'project.gamma'])[0].count).toBe(1);
      expect(db.query<{ count: number }>('SELECT COUNT(*) as count FROM resource_bindings WHERE resource_type = ? AND project_id = ?', [LocalResourceTypes.PROJECT, 'project.gamma'])[0].count).toBe(1);
      expect(db.query<{ status: string }>('SELECT status FROM execution_plans WHERE id = ?', ['project-remove-gamma'])[0].status).toBe('failure');
      expect(db.query<{ status: string }>('SELECT status FROM execution_records WHERE id = ?', ['execution-project-gamma'])[0].status).toBe('failure');
      transactionSpy.mockRestore();
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
