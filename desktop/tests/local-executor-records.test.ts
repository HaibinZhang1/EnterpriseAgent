import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalExecutor } from '../src/main/executor/local-executor';
import type { ExecutionPlan } from '../src/main/executor/types';
import { tempRoot } from './test-utils';

describe('LocalExecutor records', () => {
  it('persists redacted plan and execution records', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const plan: ExecutionPlan = {
        planId: 'record-plan', operation: 'SECRET_TEST', createdAt: new Date().toISOString(), dryRun: false, riskLevel: 'LOW',
        summary: { title: 'secret token=EAH_SENTINEL_SECRET_DO_NOT_PERSIST', description: 'record', targetCount: 1, warnings: [] },
        preconditions: [],
        steps: [{ stepId: 'write', action: 'write-file', description: 'write', targetPath: path.join(paths.tempDir, 'secret.txt'), content: 'secret=EAH_SENTINEL_SECRET_DO_NOT_PERSIST', rollbackable: true, managed: true }],
        rollbackPolicy: { strategy: 'best-effort' }, idempotencyKey: 'record-key'
      };
      const result = await new LocalExecutor().execute(plan, { allowedRoots: [paths.root], backupRoot: paths.backupsDir, db });
      expect(result.status).toBe('success');
      const planJson = db.query<{ plan_json: string }>('select plan_json from execution_plans where id = ?', [plan.planId])[0].plan_json;
      const recordJson = db.query<{ result_json: string }>('select result_json from execution_records where plan_id = ?', [plan.planId])[0].result_json;
      expect(planJson).not.toContain('EAH_SENTINEL_SECRET_DO_NOT_PERSIST');
      expect(recordJson).not.toContain('EAH_SENTINEL_SECRET_DO_NOT_PERSIST');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
