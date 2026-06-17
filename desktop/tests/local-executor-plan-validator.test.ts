import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalExecutor } from '../src/main/executor/local-executor';
import { PlanValidator } from '../src/main/executor/plan-validator';
import type { ExecutionPlan } from '../src/main/executor/types';
import { tempRoot } from './test-utils';

function plan(root: string, dryRun = true): ExecutionPlan {
  return {
    planId: 'plan_1',
    operation: 'TEST_WRITE',
    createdAt: new Date().toISOString(),
    dryRun,
    riskLevel: 'LOW',
    summary: { title: 'write', description: 'write file', targetCount: 1, warnings: [] },
    preconditions: [],
    steps: [{ stepId: 'write', action: 'write-file', description: 'write file', targetPath: path.join(root, 'file.txt'), content: 'hello', rollbackable: true, managed: true }],
    rollbackPolicy: { strategy: 'best-effort' },
    idempotencyKey: 'plan-key'
  };
}

describe('PlanValidator and dry-run executor', () => {
  it('rejects forbidden actions and leaves files untouched during dry-run', async () => {
    const temp = await tempRoot();
    try {
      const validator = new PlanValidator();
      const invalid = plan(temp.root);
      invalid.steps[0] = { ...invalid.steps[0], action: 'shell-command' as never };
      await expect(validator.validate(invalid, { allowedRoots: [temp.root] })).rejects.toMatchObject({ desktopError: { code: 'invalid_execution_plan' } });
      for (const action of ['exec-script', 'download-and-run', 'arbitrary-write', 'execute-cli', 'trigger-hook', 'start-mcp-stdio-server', 'run-plugin-lifecycle-script']) {
        const next = plan(temp.root);
        next.steps[0] = { ...next.steps[0], action: action as never };
        await expect(validator.validate(next, { allowedRoots: [temp.root] })).rejects.toMatchObject({ desktopError: { code: 'invalid_execution_plan' } });
      }
      const unmarkedRisk = plan(temp.root);
      unmarkedRisk.steps[0] = { ...unmarkedRisk.steps[0], rollbackable: false, riskLevel: undefined };
      await expect(validator.validate(unmarkedRisk, { allowedRoots: [temp.root] })).rejects.toMatchObject({ desktopError: { code: 'invalid_execution_plan' } });
      const result = await new LocalExecutor().execute(plan(temp.root), { allowedRoots: [temp.root], backupRoot: path.join(temp.root, 'backups') });
      expect(result.status).toBe('dry_run');
      await expect(readFile(path.join(temp.root, 'file.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await temp.cleanup();
    }
  });

  it('executes whitelisted writes and rolls back failed plans', async () => {
    const temp = await tempRoot();
    try {
      await mkdir(path.join(temp.root, 'source'), { recursive: true });
      const executor = new LocalExecutor();
      const success = plan(temp.root, false);
      await expect(executor.execute(success, { allowedRoots: [temp.root], backupRoot: path.join(temp.root, 'backups') })).resolves.toMatchObject({ status: 'success' });
      expect(await readFile(path.join(temp.root, 'file.txt'), 'utf8')).toBe('hello');

      const failing = plan(temp.root, false);
      failing.planId = 'plan_2';
      failing.steps.push({ stepId: 'bad-copy', action: 'copy-file', description: 'copy missing', sourcePath: path.join(temp.root, 'missing.txt'), targetPath: path.join(temp.root, 'copy.txt'), rollbackable: true, managed: true });
      const result = await executor.execute(failing, { allowedRoots: [temp.root], backupRoot: path.join(temp.root, 'backups') });
      expect(result.status).toBe('rolled_back');
      expect(await readFile(path.join(temp.root, 'file.txt'), 'utf8')).toBe('hello');
    } finally {
      await temp.cleanup();
    }
  });

  it('creates a backup snapshot before overwriting rollbackable local config', async () => {
    const temp = await tempRoot();
    try {
      const targetPath = path.join(temp.root, 'settings.json');
      const backupRoot = path.join(temp.root, 'backups');
      await writeFile(targetPath, '{"mode":"before"}\n', 'utf8');
      const writePlan = plan(temp.root, false);
      writePlan.planId = 'plan_backup_before_write';
      writePlan.summary = { title: 'Overwrite local settings', description: 'Impact: one managed settings file will be updated.', targetCount: 1, warnings: [] };
      writePlan.steps = [{
        stepId: 'write-settings',
        action: 'write-file',
        description: 'write managed settings',
        targetPath,
        content: '{"mode":"after"}\n',
        rollbackable: true,
        managed: true
      }];

      const result = await new LocalExecutor().execute(writePlan, { allowedRoots: [temp.root], backupRoot });

      expect(result.status).toBe('success');
      expect(await readFile(targetPath, 'utf8')).toBe('{"mode":"after"}\n');
      const backupRecords = (await readdir(backupRoot)).filter((item) => item.endsWith('.json'));
      expect(backupRecords).toHaveLength(1);
      const backupRecord = JSON.parse(await readFile(path.join(backupRoot, backupRecords[0]), 'utf8')) as { backupPath: string; originalPath: string; existed: boolean };
      expect(backupRecord).toMatchObject({ originalPath: targetPath, existed: true });
      expect(await readFile(backupRecord.backupPath, 'utf8')).toBe('{"mode":"before"}\n');
    } finally {
      await temp.cleanup();
    }
  });
});
