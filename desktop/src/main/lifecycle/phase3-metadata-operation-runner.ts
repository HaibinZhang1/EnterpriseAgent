import { randomUUID } from 'node:crypto';
import type { LocalDatabase } from '../db/local-database';
import type { LocalEventQueue } from '../events/local-event-queue';
import type { ExecutionPlan } from '../executor/types';
import { redactForLog } from '../../shared/redaction';
import {
  aggregateResourceChangeStatus,
  isPhase3OperationPermitted,
  type OperationPolicyDecision,
  type Phase3OperationResult,
  type ResourceChangeResult
} from '../../shared/local-phase3-operations';

export interface Phase3MetadataOperationRunnerOptions {
  db: LocalDatabase;
  eventQueue?: LocalEventQueue;
  deviceID?: string;
}

export interface Phase3MetadataOperationInput {
  plan: ExecutionPlan;
  policy: OperationPolicyDecision;
  apply?: () => Promise<ResourceChangeResult[] | void> | ResourceChangeResult[] | void;
  resourceResults?: ResourceChangeResult[];
  eventContext?: {
    extensionID?: string;
    version?: string;
    resourceID?: string;
    bindingID?: string;
    resourceType?: ResourceChangeResult['resourceType'];
    agentID?: string;
    projectID?: string;
    kitID?: string;
  };
}

export class Phase3MetadataOperationRunner {
  constructor(private readonly options: Phase3MetadataOperationRunnerOptions) {}

  async execute(input: Phase3MetadataOperationInput): Promise<Phase3OperationResult> {
    await this.persistPlan(input.plan, input.plan.dryRun ? 'dry_run' : input.policy.status);
    if (!isPhase3OperationPermitted(input.policy)) {
      const result = this.blockedResult(input);
      const executionId = await this.persistExecutionRecord(input.plan.planId, result);
      const eventId = await this.enqueueEvent(input, result, executionId);
      return { ...result, executionId, eventIds: eventId ? [eventId] : [] };
    }

    if (input.plan.dryRun) {
      const result: Phase3OperationResult = {
        operation: input.policy.operation,
        surface: input.policy.surface,
        status: 'dry_run',
        policy: input.policy,
        planId: input.plan.planId,
        resourceResults: input.resourceResults ?? [],
        eventIds: [],
        message: 'Dry run completed; no local metadata was written.',
        metadata: { dryRun: true }
      };
      const executionId = await this.persistExecutionRecord(input.plan.planId, result);
      await this.updatePlanStatus(input.plan.planId, 'dry_run');
      const eventId = await this.enqueueEvent(input, result, executionId);
      return { ...result, executionId, eventIds: eventId ? [eventId] : [] };
    }

    try {
      const applied = await input.apply?.();
      const resourceResults = applied ?? input.resourceResults ?? [this.planLevelSuccess(input)];
      const status = aggregateResourceChangeStatus(resourceResults);
      const result: Phase3OperationResult = {
        operation: input.policy.operation,
        surface: input.policy.surface,
        status,
        policy: input.policy,
        planId: input.plan.planId,
        resourceResults,
        eventIds: [],
        message: status === 'partial_success' ? 'Operation partially completed.' : 'Operation completed.',
        metadata: { metadataOnly: true }
      };
      const executionId = await this.persistExecutionRecord(input.plan.planId, result);
      await this.updatePlanStatus(input.plan.planId, status);
      const eventId = await this.enqueueEvent(input, result, executionId);
      return { ...result, executionId, eventIds: eventId ? [eventId] : [] };
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Metadata operation failed';
      const result: Phase3OperationResult = {
        operation: input.policy.operation,
        surface: input.policy.surface,
        status: 'failure',
        policy: input.policy,
        planId: input.plan.planId,
        resourceResults: [{
          status: 'failure',
          message: failureReason,
          failureReason,
          errorCode: error instanceof Error ? error.name : 'metadata_operation_failed',
          rollbackStatus: 'not_needed'
        }],
        eventIds: [],
        message: 'Operation failed.',
        failureReason,
        suggestion: '查看本地事件和执行记录后重试。',
        metadata: { metadataOnly: true }
      };
      const executionId = await this.persistExecutionRecord(input.plan.planId, result);
      await this.updatePlanStatus(input.plan.planId, 'failure');
      const eventId = await this.enqueueEvent(input, result, executionId);
      return { ...result, executionId, eventIds: eventId ? [eventId] : [] };
    }
  }

  private blockedResult(input: Phase3MetadataOperationInput): Phase3OperationResult {
    const status = input.policy.status === 'disabled' ? 'disabled' : 'blocked';
    return {
      operation: input.policy.operation,
      surface: input.policy.surface,
      status,
      policy: input.policy,
      planId: input.plan.planId,
      resourceResults: input.policy.affectedResources.map((resource) => ({
        resourceId: resource.resourceId,
        bindingId: resource.bindingId,
        resourceType: resource.resourceType,
        agentId: resource.agentId,
        projectId: resource.projectId,
        kitId: resource.kitId,
        targetPath: resource.targetPath,
        status,
        message: input.policy.reason ?? 'Operation is not allowed.',
        failureReason: input.policy.reason,
        suggestion: input.policy.suggestion
      })),
      eventIds: [],
      message: input.policy.reason ?? 'Operation is not allowed.',
      failureReason: input.policy.reason,
      suggestion: input.policy.suggestion,
      metadata: { checks: input.policy.checks }
    };
  }

  private planLevelSuccess(input: Phase3MetadataOperationInput): ResourceChangeResult {
    const first = input.policy.affectedResources[0];
    return {
      resourceId: first?.resourceId,
      bindingId: first?.bindingId,
      resourceType: first?.resourceType,
      agentId: first?.agentId,
      projectId: first?.projectId,
      kitId: first?.kitId,
      targetPath: first?.targetPath,
      status: 'success',
      message: 'Metadata operation completed.',
      rollbackStatus: 'not_needed'
    };
  }

  private async persistPlan(plan: ExecutionPlan, status: string): Promise<void> {
    const now = new Date().toISOString();
    await this.options.db.run(
      `INSERT OR REPLACE INTO execution_plans(id, status, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [plan.planId, status, JSON.stringify(redactForLog(plan)), now, now]
    );
  }

  private async updatePlanStatus(planId: string, status: string): Promise<void> {
    await this.options.db.run(`UPDATE execution_plans SET status = ?, updated_at = ? WHERE id = ?`, [status, new Date().toISOString(), planId]);
  }

  private async persistExecutionRecord(planId: string, result: Phase3OperationResult): Promise<string> {
    const now = new Date().toISOString();
    const id = `execution_record_${randomUUID()}`;
    await this.options.db.run(
      `INSERT INTO execution_records(id, plan_id, status, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, planId, result.status, JSON.stringify(redactForLog(result)), now, now]
    );
    return id;
  }

  private async enqueueEvent(input: Phase3MetadataOperationInput, result: Phase3OperationResult, executionId: string): Promise<string | undefined> {
    if (!this.options.eventQueue || !this.options.deviceID) return undefined;
    const event = await this.options.eventQueue.enqueue({
      idempotencyKey: `${input.plan.idempotencyKey}:${result.status}`,
      deviceID: this.options.deviceID,
      extensionID: input.eventContext?.extensionID ?? input.plan.extensionId,
      version: input.eventContext?.version ?? input.plan.version,
      eventType: input.plan.operation,
      operationID: input.plan.planId,
      executionID: executionId,
      resourceID: input.eventContext?.resourceID ?? result.resourceResults[0]?.resourceId,
      bindingID: input.eventContext?.bindingID ?? result.resourceResults[0]?.bindingId,
      resourceType: input.eventContext?.resourceType ?? result.resourceResults[0]?.resourceType,
      agentID: input.eventContext?.agentID ?? result.resourceResults[0]?.agentId,
      projectID: input.eventContext?.projectID ?? result.resourceResults[0]?.projectId,
      kitID: input.eventContext?.kitID ?? result.resourceResults[0]?.kitId,
      result: result.status.toUpperCase(),
      errorCode: result.status === 'success' ? undefined : result.resourceResults[0]?.errorCode,
      failureReason: result.failureReason,
      suggestion: result.suggestion,
      offlineCreated: true,
      payload: { operationResult: result }
    });
    return event.id;
  }
}

export function createPhase3MetadataPlan(input: {
  planId: string;
  operation: string;
  summaryTitle: string;
  summaryDescription: string;
  idempotencyKey: string;
  requestId?: string;
  extensionId?: string;
  version?: string;
  dryRun?: boolean;
}): ExecutionPlan {
  return {
    planId: input.planId,
    requestId: input.requestId,
    operation: input.operation,
    extensionId: input.extensionId,
    version: input.version,
    createdAt: new Date().toISOString(),
    dryRun: input.dryRun ?? false,
    riskLevel: 'LOW',
    summary: {
      title: input.summaryTitle,
      description: input.summaryDescription,
      targetCount: 0,
      warnings: ['metadata-only operation; no filesystem backup is required']
    },
    preconditions: [],
    steps: [{
      stepId: 'record-metadata-operation',
      action: 'record-state',
      description: input.summaryDescription,
      rollbackable: false,
      riskLevel: 'LOW',
      managed: true,
      metadata: { metadataOnly: true }
    }],
    rollbackPolicy: { strategy: 'none', reason: 'metadata-only operation records execution and event state without filesystem writes' },
    idempotencyKey: input.idempotencyKey
  };
}
