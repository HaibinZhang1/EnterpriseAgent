import { randomUUID } from 'node:crypto';
import { cp, mkdir, rm, symlink, writeFile, lstat, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { LocalDatabase } from '../db/local-database';
import type { LocalEventQueue } from '../events/local-event-queue';
import { BackupStore, type BackupRecord } from './backup-store';
import { HashVerifier } from './hash-verifier';
import { PlanValidator, type PlanValidationOptions } from './plan-validator';
import { RollbackManager } from './rollback-manager';
import type { ExecutionPlan, PlanResult, PlanStep, StepResult } from './types';
import { redactForLog } from '../../shared/redaction';

export interface LocalExecutorOptions extends PlanValidationOptions {
  backupRoot: string;
  db?: LocalDatabase;
  eventQueue?: LocalEventQueue;
  deviceID?: string;
}

export class LocalExecutor {
  private readonly validator = new PlanValidator();
  private readonly hashVerifier = new HashVerifier();

  async execute(plan: ExecutionPlan, options: LocalExecutorOptions): Promise<PlanResult> {
    await this.validator.validate(plan, options);
    await this.persistPlan(plan, plan.dryRun ? 'dry_run' : 'planned', options.db);
    if (plan.dryRun) return { planId: plan.planId, status: 'dry_run', dryRun: true, steps: plan.steps.map(dryRunStep) };

    const backupStore = new BackupStore(options.backupRoot);
    const backups: BackupRecord[] = [];
    const results: StepResult[] = [];
    try {
      for (const step of plan.steps) {
        const exists = step.targetPath ? await pathExists(step.targetPath) : false;
        if (step.targetPath && step.rollbackable) backups.push(await backupStore.backup(step.targetPath, exists));
        await this.applyStep(step);
        results.push({ stepId: step.stepId, action: step.action, status: 'success', rollbackStatus: 'not_needed' });
      }
      const result: PlanResult = { planId: plan.planId, status: 'success', dryRun: false, steps: results };
      await this.persistRecord(plan.planId, result, options.db);
      await this.enqueueEvent(plan, 'SUCCESS', options, result);
      return result;
    } catch (error) {
      const failedStep = plan.steps[results.length];
      const rollbackSummary = await new RollbackManager(backupStore).rollback(backups);
      const rollbackFailed = rollbackSummary.failed > 0;
      const failure: StepResult = {
        stepId: failedStep?.stepId ?? 'unknown',
        action: failedStep?.action ?? 'record-state',
        status: 'failed',
        errorCode: error instanceof Error ? error.name : 'execution_failed',
        message: error instanceof Error ? error.message : 'Execution failed',
        rollbackStatus: rollbackFailed ? 'failed' : 'success'
      };
      const result: PlanResult = {
        planId: plan.planId,
        status: rollbackFailed ? 'partial_success' : 'rolled_back',
        dryRun: false,
        steps: [...results, failure],
        failedStepId: failure.stepId,
        nextAction: rollbackFailed ? 'Inspect backup records and retry after manual cleanup' : 'Fix the failed step and retry the plan'
      };
      await this.persistRecord(plan.planId, result, options.db);
      await this.enqueueEvent(plan, rollbackFailed ? 'PARTIAL_SUCCESS' : 'FAILURE', options, result);
      return result;
    }
  }

  private async applyStep(step: PlanStep): Promise<void> {
    if (step.expectedSha256 && step.sourcePath) await this.hashVerifier.verifyFile(step.sourcePath, step.expectedSha256);
    switch (step.action) {
      case 'ensure-dir':
        await mkdir(required(step.targetPath), { recursive: true });
        break;
      case 'write-file':
      case 'switch-pointer':
      case 'record-state':
        await atomicWrite(required(step.targetPath), step.content ?? '');
        break;
      case 'copy-file':
        await cp(required(step.sourcePath), required(step.targetPath), { recursive: true, force: true });
        break;
      case 'remove-managed':
        await rm(required(step.targetPath), { recursive: true, force: true });
        break;
      case 'symlink':
        await symlink(required(step.sourcePath), required(step.targetPath));
        break;
      default:
        throw new Error(`Unsupported step action ${step.action}`);
    }
  }

  private async persistPlan(plan: ExecutionPlan, status: string, db?: LocalDatabase): Promise<void> {
    if (!db) return;
    const now = new Date().toISOString();
    await db.run(`INSERT OR REPLACE INTO execution_plans(id, status, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [plan.planId, status, JSON.stringify(redactForLog(plan)), now, now]);
  }

  private async persistRecord(planId: string, result: PlanResult, db?: LocalDatabase): Promise<void> {
    if (!db) return;
    const now = new Date().toISOString();
    await db.run(`INSERT INTO execution_records(id, plan_id, status, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [`execution_record_${randomUUID()}`, planId, result.status, JSON.stringify(redactForLog(result)), now, now]);
  }

  private async enqueueEvent(plan: ExecutionPlan, result: string, options: LocalExecutorOptions, planResult: PlanResult): Promise<void> {
    if (!options.eventQueue || !options.deviceID) return;
    await options.eventQueue.enqueue({
      idempotencyKey: `${plan.idempotencyKey}:${result.toLowerCase()}`,
      deviceID: options.deviceID,
      extensionID: plan.extensionId,
      version: plan.version,
      eventType: plan.operation,
      result,
      payload: { planId: plan.planId, summary: plan.summary, execution: planResult }
    });
  }
}

function dryRunStep(step: PlanStep): StepResult {
  return { stepId: step.stepId, action: step.action, status: 'skipped', rollbackStatus: 'not_needed', message: 'dry-run' };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(tmp, content, 'utf8');
  await readFile(tmp, 'utf8');
  await rm(filePath, { force: true });
  await rename(tmp, filePath);
}

function required(value: string | undefined): string {
  if (!value) throw new Error('Required path is missing');
  return value;
}
