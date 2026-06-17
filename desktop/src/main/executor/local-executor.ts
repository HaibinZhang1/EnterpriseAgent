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
import type { LocalResourceType } from '../../shared/local-resources';

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
    if (plan.dryRun) {
      const result: PlanResult = { planId: plan.planId, status: 'dry_run', dryRun: true, steps: plan.steps.map(dryRunStep) };
      const executionId = await this.persistRecord(plan.planId, result, options.db);
      await this.enqueueEvent(plan, 'DRY_RUN', options, result, executionId);
      return { ...result, executionId };
    }

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
      const executionId = await this.persistRecord(plan.planId, result, options.db);
      await this.updatePlanStatus(plan.planId, result.status, options.db);
      await this.enqueueEvent(plan, 'SUCCESS', options, result, executionId);
      return { ...result, executionId };
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
        status: rollbackFailed ? 'rollback_failed' : 'rolled_back',
        dryRun: false,
        steps: [...results, failure],
        failedStepId: failure.stepId,
        nextAction: rollbackFailed ? 'Inspect backup records and retry after manual cleanup' : 'Fix the failed step and retry the plan'
      };
      const executionId = await this.persistRecord(plan.planId, result, options.db);
      await this.updatePlanStatus(plan.planId, result.status, options.db);
      await this.enqueueEvent(plan, rollbackFailed ? 'ROLLBACK_FAILED' : 'FAILURE', options, result, executionId);
      return { ...result, executionId };
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
      case 'json-upsert':
        await upsertManagedJson(required(step.targetPath), step.metadata?.managedConfigId, step.content ?? '{}');
        break;
      case 'json-remove':
        await removeManagedJson(required(step.targetPath), step.metadata?.managedConfigId);
        break;
      case 'verify-hash':
        await this.hashVerifier.verifyFile(required(step.sourcePath), required(step.expectedSha256));
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

  private async persistRecord(planId: string, result: PlanResult, db?: LocalDatabase): Promise<string> {
    const executionId = `execution_record_${randomUUID()}`;
    if (!db) return executionId;
    const now = new Date().toISOString();
    await db.run(`INSERT INTO execution_records(id, plan_id, status, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [executionId, planId, result.status, JSON.stringify(redactForLog(result)), now, now]);
    return executionId;
  }

  private async updatePlanStatus(planId: string, status: string, db?: LocalDatabase): Promise<void> {
    if (!db) return;
    await db.run(`UPDATE execution_plans SET status = ?, updated_at = ? WHERE id = ?`, [status, new Date().toISOString(), planId]);
  }

  private async enqueueEvent(plan: ExecutionPlan, result: string, options: LocalExecutorOptions, planResult: PlanResult, executionId: string): Promise<void> {
    if (!options.eventQueue || !options.deviceID) return;
    const context = planEventContext(plan);
    await options.eventQueue.enqueue({
      idempotencyKey: `${plan.idempotencyKey}:${result.toLowerCase()}`,
      deviceID: options.deviceID,
      extensionID: plan.extensionId,
      version: plan.version,
      eventType: plan.operation,
      operationID: plan.planId,
      executionID: executionId,
      resourceID: context.resourceId,
      bindingID: context.bindingId,
      resourceType: context.resourceType,
      agentID: context.agentId,
      projectID: context.projectId,
      kitID: context.kitId,
      result,
      offlineCreated: true,
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

async function upsertManagedJson(filePath: string, managedConfigId: unknown, content: string): Promise<void> {
  const id = requiredManagedConfigId(managedConfigId);
  const root = await readJsonObject(filePath);
  const managed = root.enterpriseAgentHubManaged && typeof root.enterpriseAgentHubManaged === 'object' && !Array.isArray(root.enterpriseAgentHubManaged)
    ? root.enterpriseAgentHubManaged as Record<string, unknown>
    : {};
  managed[id] = JSON.parse(content);
  await atomicWrite(filePath, JSON.stringify({ ...root, enterpriseAgentHubManaged: managed }, null, 2));
}

async function removeManagedJson(filePath: string, managedConfigId: unknown): Promise<void> {
  const id = requiredManagedConfigId(managedConfigId);
  const root = await readJsonObject(filePath);
  const managed = root.enterpriseAgentHubManaged && typeof root.enterpriseAgentHubManaged === 'object' && !Array.isArray(root.enterpriseAgentHubManaged)
    ? root.enterpriseAgentHubManaged as Record<string, unknown>
    : {};
  delete managed[id];
  await atomicWrite(filePath, JSON.stringify({ ...root, enterpriseAgentHubManaged: managed }, null, 2));
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function requiredManagedConfigId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('managedConfigId is required');
  return value;
}

function planEventContext(plan: ExecutionPlan): {
  resourceId?: string;
  bindingId?: string;
  resourceType?: LocalResourceType;
  agentId?: string;
  projectId?: string;
  kitId?: string;
} {
  for (const step of plan.steps) {
    const metadata = step.metadata ?? {};
    const resourceId = stringMetadata(metadata.resourceId);
    const bindingId = stringMetadata(metadata.bindingId);
    const resourceType = stringMetadata(metadata.resourceType) as LocalResourceType | undefined;
    const agentId = stringMetadata(metadata.agentId);
    const projectId = stringMetadata(metadata.projectId);
    const kitId = stringMetadata(metadata.kitId);
    if (resourceId || bindingId || resourceType || agentId || projectId || kitId) {
      return { resourceId, bindingId, resourceType, agentId, projectId, kitId };
    }
  }
  return {};
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
