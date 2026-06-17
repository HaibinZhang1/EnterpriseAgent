import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppPaths } from '../config/app-paths';
import type { DeviceInfo } from '../config/device-id-store';
import type { LocalDatabase } from '../db/local-database';
import type { LocalEventQueue } from '../events/local-event-queue';
import type { LocalExecutor } from '../executor/local-executor';
import type { ExecutionPlan, PlanResult, PlanStep, StepResult } from '../executor/types';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';
import { auditStaticResource } from '../../shared/local-audit';
import {
  aggregateResourceChangeStatus,
  createPhase3OperationPolicyDecision,
  isPhase3OperationPermitted,
  toPhase3ResourceContext,
  type OperationPolicyDecision,
  type Phase3OperationResult,
  type ResourceChangeResult
} from '../../shared/local-phase3-operations';
import {
  AuditStatuses,
  AuthStatuses,
  DriftStatuses,
  LocalEventTypes,
  LocalResourceTypes,
  ResourceScopeTypes,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  extractKitManifest,
  isKitManifest,
  type AuditStatus,
  type AuditSummary,
  type KitManifest,
  type KitResourceKind,
  type KitResourceRef,
  type LocalResourceRow,
  type LocalResourceSnapshot,
  type LocalResourceType,
  type PermissionCategory,
  type PermissionItem,
  type PermissionSummary,
  type ResourceBinding,
  type ResourceScopeType
} from '../../shared/local-resources';
import { createPhase3MetadataPlan, Phase3MetadataOperationRunner } from './phase3-metadata-operation-runner';
import type { KitApplicationTargetRecord, LocalLifecycleRepository, RemovedKitBindingRecord as RemovedKitBinding } from './local-lifecycle-repository';

export interface LocalKitServiceOptions {
  db: LocalDatabase;
  eventQueue: LocalEventQueue;
  lifecycleRepository: LocalLifecycleRepository;
  localExecutor: LocalExecutor;
  paths: AppPaths;
  getDeviceInfo: () => Promise<DeviceInfo>;
}

export interface KitApplicationTargetInput {
  scopeType?: ResourceScopeType;
  agentId?: string;
  projectId?: string;
  scopePath?: string;
  targetPath?: string;
}

export interface KitExportResult {
  manifest: KitManifest;
  policy: OperationPolicyDecision;
  plan?: ExecutionPlan;
  result?: PlanResult;
  operationResult?: Phase3OperationResult;
}

export class LocalKitService {
  constructor(private readonly options: LocalKitServiceOptions) {}

  async importManifest(input: { manifest: unknown; sourcePath?: string; requestID?: string; dryRun?: boolean }): Promise<Phase3OperationResult> {
    const manifest = requireKitManifest(input.manifest, input.requestID);
    const resourceId = resourceIdFor(LocalResourceTypes.KIT, manifest.kitId);
    const policy = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.import',
      resources: [{ resourceId, resourceType: LocalResourceTypes.KIT, name: manifest.name, authStatus: AuthStatuses.UNKNOWN }]
    });
    return this.executeMetadata({
      manifest,
      policy,
      operation: LocalEventTypes.KIT_IMPORTED,
      summaryTitle: '导入 Kit manifest',
      summaryDescription: '记录 Kit manifest 为未应用本地资源，不写入智能体目录。',
      requestID: input.requestID,
      dryRun: input.dryRun,
      apply: async () => {
        await this.options.lifecycleRepository.recordKitManifest({
          manifest,
          sourcePath: input.sourcePath,
          metadata: { importedAt: new Date().toISOString(), unapplied: true }
        });
        return [{
          resourceId,
          resourceType: LocalResourceTypes.KIT,
          kitId: manifest.kitId,
          status: 'success',
          message: 'Kit manifest 已导入为未应用记录；未写入本地智能体目录。',
          rollbackStatus: 'not_needed',
          metadata: { unapplied: true }
        }];
      }
    });
  }

  async generateFromAgent(input: { agentId: string; kitId: string; name: string; version?: string; description?: string; requestID?: string; dryRun?: boolean }): Promise<Phase3OperationResult> {
    const snapshot = this.options.lifecycleRepository.listResources();
    const rows = snapshot.rows.filter((row) => row.binding?.agentId === input.agentId && isKitResourceKind(row.resource.type));
    const manifest = buildManifestFromRows(rows, {
      kitId: input.kitId,
      name: input.name,
      version: input.version,
      description: input.description,
      sourceType: 'local',
      supportedAgents: [input.agentId],
      metadata: { generatedFrom: 'agent', agentId: input.agentId }
    }, input.requestID);
    return this.recordGeneratedManifest(manifest, 'kit.generate-from-agent', input.requestID, input.dryRun);
  }

  async generateFromProject(input: { projectId: string; kitId: string; name: string; version?: string; description?: string; requestID?: string; dryRun?: boolean }): Promise<Phase3OperationResult> {
    const snapshot = this.options.lifecycleRepository.listResources();
    const rows = snapshot.rows.filter((row) => row.binding?.projectId === input.projectId && isKitResourceKind(row.resource.type));
    const agents = unique(rows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
    const manifest = buildManifestFromRows(rows, {
      kitId: input.kitId,
      name: input.name,
      version: input.version,
      description: input.description,
      sourceType: 'local',
      supportedAgents: agents,
      metadata: { generatedFrom: 'project', projectId: input.projectId }
    }, input.requestID);
    return this.recordGeneratedManifest(manifest, 'kit.generate-from-project', input.requestID, input.dryRun);
  }

  async exportManifest(input: { kitId: string; targetPath?: string; requestID?: string; dryRun?: boolean }): Promise<KitExportResult> {
    const manifest = this.requireStoredManifest(input.kitId, input.requestID);
    const resourceId = resourceIdFor(LocalResourceTypes.KIT, manifest.kitId);
    if (!input.targetPath) {
      const policy = createPhase3OperationPolicyDecision({
        surface: 'toolkits',
        operation: 'kit.export-data',
        resources: [{ resourceId, resourceType: LocalResourceTypes.KIT, kitId: manifest.kitId, name: manifest.name }]
      });
      const operationResult = await this.executeMetadata({
        manifest,
        policy,
        operation: LocalEventTypes.KIT_EXPORTED,
        summaryTitle: '导出 Kit manifest 数据',
        summaryDescription: '读取 Kit manifest 数据，不写入本地文件。',
        requestID: input.requestID,
        dryRun: input.dryRun,
        apply: () => [{
          resourceId,
          resourceType: LocalResourceTypes.KIT,
          kitId: manifest.kitId,
          status: 'success',
          message: 'Kit manifest 数据已导出到返回结果。',
          rollbackStatus: 'not_needed',
          metadata: { manifest }
        }]
      });
      return { manifest, policy, operationResult };
    }

    const targetPath = path.resolve(input.targetPath);
    const policy = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.export',
      resources: [{ resourceId, resourceType: LocalResourceTypes.KIT, kitId: manifest.kitId, name: manifest.name }]
    });
    if (!isPhase3OperationPermitted(policy)) {
      throw new DesktopErrorException(makeDesktopError('scope_restricted', policy.reason ?? 'Kit export is blocked by policy', input.requestID, { policy }));
    }
    const plan = createKitExportPlan({
      manifest,
      targetPath,
      requestID: input.requestID,
      dryRun: input.dryRun,
      resourceId
    });
    const result = await this.options.localExecutor.execute(plan, {
      allowedRoots: [this.options.paths.root, path.dirname(targetPath)],
      managedPaths: [targetPath],
      backupRoot: this.options.paths.backupsDir,
      db: this.options.db,
      eventQueue: this.options.eventQueue,
      deviceID: (await this.options.getDeviceInfo()).deviceID
    });
    return { manifest, policy, plan, result };
  }

  async apply(input: { kitId?: string; manifest?: unknown; target: KitApplicationTargetInput; applicationId?: string; requestID?: string; dryRun?: boolean }): Promise<Phase3OperationResult> {
    const manifest = input.manifest ? requireKitManifest(input.manifest, input.requestID) : this.requireStoredManifest(required(input.kitId, 'kitId', input.requestID), input.requestID);
    const target = normalizeTarget(input.target, input.requestID);
    const applicationId = input.applicationId ?? deterministicApplicationId(manifest.kitId, target);
    const snapshot = this.options.lifecycleRepository.listResources();
    const resolutions = resolveManifestResources(manifest, snapshot);
    const policy = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.apply',
      resources: resolutions.flatMap((resolution) => resolution.row
        ? [toPhase3ResourceContext({
          resource: resolution.row.resource,
          binding: resolution.row.binding,
          expectedHash: resolution.expectedHash,
          metadata: { managedByKitId: manifest.kitId, kitApplicationId: applicationId }
        })]
        : []),
      metadata: { kitId: manifest.kitId, applicationId, target }
    });
    if (!isPhase3OperationPermitted(policy)) {
      return this.executeMetadata({
        manifest,
        policy,
        operation: LocalEventTypes.KIT_APPLIED,
        summaryTitle: '应用 Kit',
        summaryDescription: '按 Kit manifest 逐资源记录应用结果。',
        requestID: input.requestID,
        dryRun: input.dryRun,
        apply: () => []
      });
    }

    const prepared = prepareKitApplyResources({ manifest, target, resolutions, applicationId });
    if (prepared.executable.length === 0) {
      return this.executeMetadata({
        manifest,
        policy,
        operation: LocalEventTypes.KIT_APPLIED,
        summaryTitle: '应用 Kit',
        summaryDescription: 'Kit 没有可执行资源；记录逐资源失败结果。',
        requestID: input.requestID,
        dryRun: input.dryRun,
        apply: () => prepared.preflight.length > 0 ? prepared.preflight : [emptyKitManifestResult(manifest)]
      });
    }
    const plan = createKitApplicationPlan({
      manifest,
      target,
      applicationId,
      requestID: input.requestID,
      dryRun: input.dryRun,
      operation: LocalEventTypes.KIT_APPLIED,
      resources: prepared.executable
    }, this.options.paths.eventsDir);
    return this.executeKitPlan({
      manifest,
      policy,
      plan,
      eventType: LocalEventTypes.KIT_APPLIED,
      eventContext: { resourceID: resourceIdFor(LocalResourceTypes.KIT, manifest.kitId), resourceType: LocalResourceTypes.KIT, kitID: manifest.kitId },
      mapPlanResult: async (planResult) => {
        const results = [...prepared.preflight];
        if (planResult.status === 'dry_run') {
          return [
            ...results,
            ...prepared.executable.map((candidate) => dryRunResourceResult(candidate, planResult, manifest.kitId, target))
          ];
        }
        if (planResult.status === 'success') {
          for (const candidate of prepared.executable) {
            try {
              const binding = await this.options.lifecycleRepository.recordKitManagedResourceBinding({
                manifest,
                resourceRef: candidate.resolution.ref,
                resourceId: candidate.resolution.row.resource.id,
                applicationId,
                target,
                status: 'enabled',
                operationId: LocalEventTypes.KIT_APPLIED,
                metadata: { sourceBindingId: candidate.resolution.row.binding?.id, executionPlanId: plan.planId, executionId: planResult.executionId }
              });
              results.push({
                resourceRefId: candidate.resolution.ref.refId,
                resourceId: candidate.resolution.row.resource.id,
                bindingId: binding?.bindingId,
                resourceType: candidate.resolution.ref.resourceType,
                agentId: target.agentId,
                projectId: target.projectId,
                kitId: manifest.kitId,
                targetPath: candidate.targetPath,
                status: binding ? 'success' : 'failure',
                message: binding
                  ? kitApplyResourceMessage(candidate.resolution.ref)
                  : '资源存在且执行计划成功，但无法记录 Kit 托管绑定。',
                failureReason: binding ? undefined : 'Kit binding write failed',
                rollbackStatus: stepRollbackStatus(planResult, candidate.stepId)
              });
            } catch (error) {
              results.push(bindingMaterializationFailure(candidate, manifest.kitId, target, error, stepRollbackStatus(planResult, candidate.stepId)));
            }
          }
          const aggregateStatus = aggregateResourceChangeStatus(results);
          try {
            await this.options.lifecycleRepository.recordKitApplicationBinding({
              manifest,
              applicationId,
              target,
              status: aggregateStatus,
              operationId: LocalEventTypes.KIT_APPLIED,
              resourceResults: results,
              metadata: { executionPlanId: plan.planId, executionId: planResult.executionId }
            });
          } catch (error) {
            results.push(kitApplicationBindingFailure(manifest, target, error));
          }
          return results.length > 0 ? results : [emptyKitManifestResult(manifest)];
        }
        return [
          ...results,
          ...prepared.executable.map((candidate) => failedPlanResourceResult(candidate, planResult, manifest.kitId, target))
        ];
      }
    });
  }

  async removeApplication(input: { kitId: string; applicationId?: string; requestID?: string; dryRun?: boolean }): Promise<Phase3OperationResult> {
    const manifest = this.requireStoredManifest(input.kitId, input.requestID);
    const resourceId = resourceIdFor(LocalResourceTypes.KIT, manifest.kitId);
    const policy = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.remove-application',
      resources: [{ resourceId, resourceType: LocalResourceTypes.KIT, kitId: manifest.kitId, name: manifest.name }],
      metadata: { kitId: manifest.kitId, applicationId: input.applicationId }
    });
    if (!isPhase3OperationPermitted(policy)) {
      return this.executeMetadata({
        manifest,
        policy,
        operation: LocalEventTypes.KIT_APPLICATION_REMOVED,
        summaryTitle: '移除 Kit 应用',
        summaryDescription: '只移除 Kit 托管的本地资源绑定，不删除用户原有配置。',
        requestID: input.requestID,
        dryRun: input.dryRun,
        apply: () => []
      });
    }

    const removable = this.options.lifecycleRepository.listResources().bindings
      .filter((binding) => binding.kitId === manifest.kitId || binding.metadata.managedByKitId === manifest.kitId)
      .filter((binding) => !input.applicationId || binding.metadata.kitApplicationId === input.applicationId);
    if (removable.length === 0) {
      return this.executeMetadata({
        manifest,
        policy,
        operation: LocalEventTypes.KIT_APPLICATION_REMOVED,
        summaryTitle: '移除 Kit 应用',
        summaryDescription: '只移除 Kit 托管的本地资源绑定，不删除用户原有配置。',
        requestID: input.requestID,
        dryRun: input.dryRun,
        apply: () => [{
          resourceId,
          resourceType: LocalResourceTypes.KIT,
          kitId: manifest.kitId,
          status: 'failure',
          message: '未找到可移除的 Kit 托管资源绑定。',
          failureReason: 'no_kit_managed_bindings',
          suggestion: '确认应用 ID 或先查看应用分布。',
          rollbackStatus: 'not_needed'
        }]
      });
    }
    const removePlan = createKitRemovePlan({
      manifest,
      applicationId: input.applicationId,
      requestID: input.requestID,
      dryRun: input.dryRun,
      bindings: removable
    }, this.options.paths.eventsDir);
    return this.executeKitPlan({
      manifest,
      policy,
      plan: removePlan,
      eventType: LocalEventTypes.KIT_APPLICATION_REMOVED,
      eventContext: { resourceID: resourceId, resourceType: LocalResourceTypes.KIT, kitID: manifest.kitId },
      mapPlanResult: async (planResult) => {
        if (planResult.status === 'dry_run') {
          return removable.map((binding) => dryRunBindingResult(binding, manifest.kitId, planResult));
        }
        if (planResult.status !== 'success') {
          return removable.map((binding) => failedPlanBindingResult(binding, manifest.kitId, planResult));
        }
        const results: ResourceChangeResult[] = [];
        for (const binding of removable) {
          try {
            const removed = await this.options.lifecycleRepository.removeKitManagedBinding({
              kitId: manifest.kitId,
              applicationId: input.applicationId,
              bindingId: binding.id,
              operationId: LocalEventTypes.KIT_APPLICATION_REMOVED,
              executionId: planResult.executionId
            });
            results.push(removed ? removedBindingResult(removed, manifest.kitId, planResult) : notKitManagedBindingResult(binding, manifest.kitId, planResult));
          } catch (error) {
            results.push(removeBindingMaterializationFailure(binding, manifest.kitId, planResult, error));
          }
        }
        return results;
      }
    });
  }

  async checkDrift(input: { kitId: string; requestID?: string; dryRun?: boolean }): Promise<Phase3OperationResult> {
    const manifest = this.requireStoredManifest(input.kitId, input.requestID);
    const resourceId = resourceIdFor(LocalResourceTypes.KIT, manifest.kitId);
    const policy = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.drift-check',
      resources: [{ resourceId, resourceType: LocalResourceTypes.KIT, kitId: manifest.kitId, name: manifest.name }]
    });
    return this.executeMetadata({
      manifest,
      policy,
      operation: LocalEventTypes.KIT_DRIFT_CHECKED,
      summaryTitle: '检查 Kit 漂移',
      summaryDescription: '基于 manifest Hash 和本地资源记录检查漂移，不执行 Hook、CLI 或 MCP stdio。',
      requestID: input.requestID,
      dryRun: input.dryRun,
      apply: () => {
        const findings = detectKitDrift(manifest, this.options.lifecycleRepository.listResources());
        if (findings.length === 0) {
          return [{
            resourceId,
            resourceType: LocalResourceTypes.KIT,
            kitId: manifest.kitId,
            status: 'success',
            message: '未发现 Kit Hash 或托管绑定漂移。',
            rollbackStatus: 'not_needed'
          }];
        }
        return findings;
      }
    });
  }

  async runStaticAudit(input: { kitId: string; requestID?: string; dryRun?: boolean }): Promise<Phase3OperationResult> {
    const manifest = this.requireStoredManifest(input.kitId, input.requestID);
    const resourceId = resourceIdFor(LocalResourceTypes.KIT, manifest.kitId);
    const policy = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.static-audit-run',
      resources: [{ resourceId, resourceType: LocalResourceTypes.KIT, kitId: manifest.kitId, name: manifest.name }]
    });
    return this.executeMetadata({
      manifest,
      policy,
      operation: LocalEventTypes.KIT_STATIC_AUDITED,
      summaryTitle: '运行 Kit 静态审计',
      summaryDescription: '读取 Kit manifest 和本地记录做静态审计，不下载缺失资源。',
      requestID: input.requestID,
      dryRun: input.dryRun,
      apply: async () => {
        const snapshot = this.options.lifecycleRepository.listResources();
        const auditResult = auditStaticResource({
          resourceId,
          resourceType: LocalResourceTypes.KIT,
          name: manifest.name,
          content: JSON.stringify(kitAuditInput(manifest, snapshot), null, 2),
          path: `kit://${manifest.kitId}`,
          kitId: manifest.kitId,
          permissionSummary: manifest.permissionSummary,
          metadata: {
            ...manifest.metadata,
            sourceType: manifest.sourceType,
            resourceCount: manifest.resources.length,
            supportedAgents: manifest.supportedAgents,
            supportedPlatforms: manifest.supportedPlatforms,
            conflictPolicy: manifest.conflictPolicy,
            rollbackPolicy: manifest.rollbackPolicy
          },
          knownResourceIds: snapshot.resources.map((resource) => resource.id),
          relatedEventIds: snapshot.events.filter((event) => event.kitId === manifest.kitId || event.resourceId === resourceId).map((event) => event.eventId)
        }, { runId: `kit_static_audit_${stableId(manifest.kitId)}` });
        await this.options.lifecycleRepository.upsertAuditRunFindings(auditResult.runId, auditResult.findings, [{ resourceId }]);
        return [{
          resourceId,
          resourceType: LocalResourceTypes.KIT,
          kitId: manifest.kitId,
          status: auditResult.status === AuditStatuses.SECURITY_RISK ? 'failure' : 'success',
          message: `Kit 静态审计完成：${auditResult.summary.findingCount} 项发现，Trust Score ${auditResult.trustScore}。`,
          failureReason: auditResult.status === AuditStatuses.SECURITY_RISK ? 'kit_security_risk' : undefined,
          suggestion: auditResult.status === AuditStatuses.SECURITY_RISK ? '先处理阻断级审计发现，再应用 Kit。' : undefined,
          rollbackStatus: 'not_needed',
          metadata: { auditSummary: auditResult.summary, runId: auditResult.runId }
        }];
      }
    });
  }

  private async recordGeneratedManifest(manifest: KitManifest, operation: 'kit.generate-from-agent' | 'kit.generate-from-project', requestID?: string, dryRun?: boolean): Promise<Phase3OperationResult> {
    const resourceId = resourceIdFor(LocalResourceTypes.KIT, manifest.kitId);
    const policy = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation,
      resources: [{ resourceId, resourceType: LocalResourceTypes.KIT, kitId: manifest.kitId, name: manifest.name }]
    });
    return this.executeMetadata({
      manifest,
      policy,
      operation: LocalEventTypes.KIT_GENERATED,
      summaryTitle: '生成 Kit',
      summaryDescription: '从当前本地资源快照生成 Kit manifest，并记录为未应用本地资源。',
      requestID,
      dryRun,
      apply: async () => {
        await this.options.lifecycleRepository.recordKitManifest({
          manifest,
          metadata: { generatedAt: new Date().toISOString(), unapplied: true }
        });
        return [{
          resourceId,
          resourceType: LocalResourceTypes.KIT,
          kitId: manifest.kitId,
          status: 'success',
          message: 'Kit manifest 已从真实本地资源生成并保持未应用状态。',
          rollbackStatus: 'not_needed',
          metadata: { resourceCount: manifest.resources.length }
        }];
      }
    });
  }

  private requireStoredManifest(kitId: string, requestID?: string): KitManifest {
    const snapshot = this.options.lifecycleRepository.listResources();
    const resource = snapshot.resources.find((item) => item.type === LocalResourceTypes.KIT && (item.sourceId === kitId || extractKitManifest(item.metadata)?.kitId === kitId));
    const manifest = extractKitManifest(resource?.metadata);
    if (!manifest) {
      throw new DesktopErrorException(makeDesktopError('resource_not_found', `Kit manifest not found: ${kitId}`, requestID));
    }
    return manifest;
  }

  private async executeMetadata(input: {
    manifest: KitManifest;
    policy: OperationPolicyDecision;
    operation: string;
    summaryTitle: string;
    summaryDescription: string;
    requestID?: string;
    dryRun?: boolean;
    apply: () => Promise<ResourceChangeResult[] | void> | ResourceChangeResult[] | void;
  }): Promise<Phase3OperationResult> {
    const resourceId = resourceIdFor(LocalResourceTypes.KIT, input.manifest.kitId);
    const runner = new Phase3MetadataOperationRunner({
      db: this.options.db,
      eventQueue: this.options.eventQueue,
      deviceID: (await this.options.getDeviceInfo()).deviceID
    });
    return runner.execute({
      plan: createPhase3MetadataPlan({
        planId: `kit_${input.operation.toLowerCase()}_${randomUUID()}`,
        operation: input.operation,
        summaryTitle: input.summaryTitle,
        summaryDescription: input.summaryDescription,
        idempotencyKey: `kit:${input.operation}:${input.manifest.kitId}:${input.requestID ?? randomUUID()}`,
        requestId: input.requestID,
        dryRun: input.dryRun
      }),
      policy: input.policy,
      eventContext: {
        resourceID: resourceId,
        resourceType: LocalResourceTypes.KIT,
        kitID: input.manifest.kitId
      },
      apply: input.apply
    });
  }

  private async executeKitPlan(input: {
    manifest: KitManifest;
    policy: OperationPolicyDecision;
    plan: ExecutionPlan;
    eventType: string;
    eventContext: {
      resourceID?: string;
      bindingID?: string;
      resourceType?: LocalResourceType;
      agentID?: string;
      projectID?: string;
      kitID?: string;
    };
    mapPlanResult: (planResult: PlanResult) => Promise<ResourceChangeResult[]>;
  }): Promise<Phase3OperationResult> {
    const result = await this.options.localExecutor.execute(input.plan, {
      allowedRoots: [this.options.paths.root],
      managedPaths: input.plan.steps.flatMap((step) => step.targetPath ? [step.targetPath] : []),
      backupRoot: this.options.paths.backupsDir,
      db: this.options.db
    });
    const resourceResults = await input.mapPlanResult(result);
    const status = aggregateResourceChangeStatus(resourceResults, planStatusToOperationStatus(result));
    const operationResult: Phase3OperationResult = {
      operation: input.policy.operation,
      surface: input.policy.surface,
      status,
      policy: input.policy,
      planId: input.plan.planId,
      executionId: result.executionId,
      resourceResults,
      eventIds: [],
      message: operationMessage(status),
      failureReason: status === 'success' || status === 'dry_run' ? undefined : result.nextAction,
      suggestion: status === 'success' || status === 'dry_run' ? undefined : result.nextAction,
      metadata: { execution: result }
    };
    const device = await this.options.getDeviceInfo();
    const event = await this.options.eventQueue.enqueue({
      idempotencyKey: `${input.plan.idempotencyKey}:operation-result:${status}`,
      deviceID: device.deviceID,
      eventType: input.eventType,
      operationID: input.plan.planId,
      executionID: result.executionId,
      resourceID: input.eventContext.resourceID ?? resourceResults[0]?.resourceId,
      bindingID: input.eventContext.bindingID ?? resourceResults[0]?.bindingId,
      resourceType: input.eventContext.resourceType ?? resourceResults[0]?.resourceType,
      agentID: input.eventContext.agentID ?? resourceResults[0]?.agentId,
      projectID: input.eventContext.projectID ?? resourceResults[0]?.projectId,
      kitID: input.eventContext.kitID ?? input.manifest.kitId,
      result: status.toUpperCase(),
      errorCode: status === 'success' ? undefined : resourceResults.find((item) => item.errorCode)?.errorCode,
      failureReason: operationResult.failureReason,
      suggestion: operationResult.suggestion,
      offlineCreated: true,
      payload: { operationResult }
    });
    return { ...operationResult, eventIds: [event.id] };
  }
}

function createKitExportPlan(input: { manifest: KitManifest; targetPath: string; requestID?: string; dryRun?: boolean; resourceId: string }): ExecutionPlan {
  return {
    planId: `kit_export_${input.manifest.kitId}_${randomUUID()}`,
    requestId: input.requestID,
    operation: LocalEventTypes.KIT_EXPORTED,
    createdAt: new Date().toISOString(),
    dryRun: input.dryRun ?? false,
    riskLevel: 'LOW',
    summary: {
      title: '导出 Kit manifest 文件',
      description: '将 Kit manifest 写入用户选择的导出文件。',
      targetCount: 1,
      warnings: ['导出文件写入通过 LocalExecutor 执行，覆盖目标前会备份现有文件。']
    },
    preconditions: [],
    steps: [{
      stepId: 'write-kit-manifest',
      action: 'write-file',
      description: '写入 Kit manifest JSON',
      targetPath: input.targetPath,
      content: `${JSON.stringify({ manifest: input.manifest }, null, 2)}\n`,
      rollbackable: true,
      managed: true,
      metadata: {
        resourceId: input.resourceId,
        resourceType: LocalResourceTypes.KIT,
        kitId: input.manifest.kitId
      }
    }],
    rollbackPolicy: { strategy: 'best-effort', reason: '目标导出文件覆盖前由 BackupStore 记录快照。' },
    idempotencyKey: `kit:export-file:${input.manifest.kitId}:${input.targetPath}`
  };
}

function createKitApplicationPlan(input: {
  manifest: KitManifest;
  target: KitApplicationTargetRecord;
  applicationId: string;
  requestID?: string;
  dryRun?: boolean;
  operation: string;
  resources: PreparedKitResource[];
}, eventsDir: string): ExecutionPlan {
  const baseDir = path.join(eventsDir, 'kit-applications', safePathSegment(input.applicationId));
  return {
    planId: `kit_apply_${input.manifest.kitId}_${randomUUID()}`,
    requestId: input.requestID,
    operation: input.operation,
    createdAt: new Date().toISOString(),
    dryRun: input.dryRun ?? false,
    riskLevel: input.resources.some((candidate) => isFileBackedKitResource(candidate.resolution.ref.resourceType)) ? 'MEDIUM' : 'LOW',
    summary: {
      title: '应用 Kit',
      description: '先通过 ExecutionPlan 记录逐资源应用意图，再写入 Kit 托管绑定。',
      targetCount: input.resources.length,
      warnings: [
        'Kit 应用不会执行 Hook、CLI 或 MCP stdio/command；阶段三只写入受管元数据和静态配置记录。',
        '事务标记文件位于 EnterpriseAgentHub app-data，覆盖前由 BackupStore 保护。'
      ]
    },
    preconditions: [{
      id: 'kit-has-executable-resources',
      description: input.resources.length > 0 ? 'Kit 至少包含一个通过 Hash/存在性检查的资源。' : 'Kit 没有任何可应用资源。',
      satisfied: input.resources.length > 0,
      errorCode: input.resources.length > 0 ? undefined : 'empty_kit_manifest'
    }],
    steps: input.resources.map((candidate) => ({
      stepId: candidate.stepId,
      action: 'record-state',
      description: `记录 Kit 资源应用意图：${candidate.resolution.ref.refId}`,
      targetPath: path.join(baseDir, `${safePathSegment(candidate.resolution.ref.refId)}.json`),
      content: `${JSON.stringify({
        kitId: input.manifest.kitId,
        applicationId: input.applicationId,
        target: input.target,
        resourceRef: candidate.resolution.ref,
        resourceId: candidate.resolution.row.resource.id,
        sourceBindingId: candidate.resolution.row.binding?.id,
        staticOnly: isStaticOnlyKitResource(candidate.resolution.ref.resourceType)
      }, null, 2)}\n`,
      rollbackable: true,
      managed: true,
      metadata: {
        resourceId: candidate.resolution.row.resource.id,
        bindingId: candidate.resolution.row.binding?.id,
        resourceType: candidate.resolution.ref.resourceType,
        agentId: input.target.agentId,
        projectId: input.target.projectId,
        kitId: input.manifest.kitId,
        kitApplicationId: input.applicationId
      }
    } satisfies PlanStep)),
    rollbackPolicy: { strategy: 'best-effort', reason: 'Kit 应用的事务标记文件由 BackupStore 回滚；DB 绑定只在计划成功后写入。' },
    idempotencyKey: `kit:apply:${input.manifest.kitId}:${input.applicationId}`
  };
}

function createKitRemovePlan(input: {
  manifest: KitManifest;
  applicationId?: string;
  requestID?: string;
  dryRun?: boolean;
  bindings: ResourceBinding[];
}, eventsDir: string): ExecutionPlan {
  const scope = input.applicationId ?? 'all-applications';
  const baseDir = path.join(eventsDir, 'kit-removals', safePathSegment(input.manifest.kitId), safePathSegment(scope));
  return {
    planId: `kit_remove_${input.manifest.kitId}_${randomUUID()}`,
    requestId: input.requestID,
    operation: LocalEventTypes.KIT_APPLICATION_REMOVED,
    createdAt: new Date().toISOString(),
    dryRun: input.dryRun ?? false,
    riskLevel: 'LOW',
    summary: {
      title: '移除 Kit 应用',
      description: '先通过 ExecutionPlan 记录逐绑定移除意图，再删除 Kit 托管绑定。',
      targetCount: input.bindings.length,
      warnings: [
        '只移除 Kit 托管绑定，不删除用户原有配置或真实项目目录。',
        '事务标记文件位于 EnterpriseAgentHub app-data，覆盖前由 BackupStore 保护。'
      ]
    },
    preconditions: [{
      id: 'kit-managed-bindings-exist',
      description: input.bindings.length > 0 ? '存在可移除的 Kit 托管绑定。' : '未找到可移除的 Kit 托管绑定。',
      satisfied: input.bindings.length > 0,
      errorCode: input.bindings.length > 0 ? undefined : 'no_kit_managed_bindings'
    }],
    steps: input.bindings.map((binding) => ({
      stepId: stepIdForBinding(binding.id),
      action: 'record-state',
      description: `记录 Kit 托管绑定移除意图：${binding.id}`,
      targetPath: path.join(baseDir, `${safePathSegment(binding.id)}.json`),
      content: `${JSON.stringify({
        kitId: input.manifest.kitId,
        applicationId: input.applicationId,
        bindingId: binding.id,
        resourceId: binding.resourceId,
        resourceType: binding.resourceType,
        agentId: binding.agentId,
        projectId: binding.projectId,
        targetPath: binding.targetPath
      }, null, 2)}\n`,
      rollbackable: true,
      managed: true,
      metadata: {
        resourceId: binding.resourceId,
        bindingId: binding.id,
        resourceType: binding.resourceType,
        agentId: binding.agentId,
        projectId: binding.projectId,
        kitId: input.manifest.kitId,
        kitApplicationId: input.applicationId
      }
    } satisfies PlanStep)),
    rollbackPolicy: { strategy: 'best-effort', reason: 'Kit 移除的事务标记文件由 BackupStore 回滚；DB 绑定只在计划成功后删除。' },
    idempotencyKey: `kit:remove:${input.manifest.kitId}:${scope}`
  };
}

interface PreparedKitResource {
  resolution: ResolvedKitResource & { row: LocalResourceRow };
  stepId: string;
  targetPath?: string;
}

interface ResolvedKitResource {
  ref: KitResourceRef;
  row?: LocalResourceRow;
  expectedHash?: string;
  hashError?: string;
}

function prepareKitApplyResources(input: {
  manifest: KitManifest;
  target: KitApplicationTargetRecord;
  resolutions: ResolvedKitResource[];
  applicationId: string;
}): { preflight: ResourceChangeResult[]; executable: PreparedKitResource[] } {
  const preflight: ResourceChangeResult[] = [];
  const executable: PreparedKitResource[] = [];
  for (const resolution of input.resolutions) {
    if (!resolution.row) {
      preflight.push(missingResourceResult(resolution.ref));
      continue;
    }
    const targetPath = resolution.ref.targetPath ?? input.target.targetPath ?? input.target.scopePath;
    if (resolution.hashError) {
      preflight.push({
        resourceRefId: resolution.ref.refId,
        resourceId: resolution.row.resource.id,
        bindingId: resolution.row.binding?.id,
        resourceType: resolution.ref.resourceType,
        agentId: input.target.agentId,
        projectId: input.target.projectId,
        kitId: input.manifest.kitId,
        targetPath,
        status: 'failure',
        message: resolution.hashError,
        errorCode: 'hash_mismatch',
        failureReason: resolution.hashError,
        suggestion: '先处理 Hash 异常或重新生成 Kit manifest。',
        rollbackStatus: 'not_needed'
      });
      continue;
    }
    executable.push({
      resolution: resolution as ResolvedKitResource & { row: LocalResourceRow },
      stepId: stepIdForResourceRef(resolution.ref.refId),
      targetPath
    });
  }
  return { preflight, executable };
}

function failedPlanResourceResult(candidate: PreparedKitResource, planResult: PlanResult, kitId: string, target: KitApplicationTargetRecord): ResourceChangeResult {
  const step = stepResultFor(planResult, candidate.stepId);
  const rolledBack = planResult.status === 'rolled_back' || step?.rollbackStatus === 'success';
  const rollbackFailed = planResult.status === 'rollback_failed' || step?.rollbackStatus === 'failed';
  return {
    resourceRefId: candidate.resolution.ref.refId,
    resourceId: candidate.resolution.row.resource.id,
    bindingId: candidate.resolution.row.binding?.id,
    resourceType: candidate.resolution.ref.resourceType,
    agentId: target.agentId,
    projectId: target.projectId,
    kitId,
    targetPath: candidate.targetPath,
    status: rollbackFailed ? 'rollback_failed' : rolledBack ? 'rolled_back' : 'failure',
    message: step?.message ?? planResult.nextAction ?? 'Kit 应用执行计划未成功，未写入 Kit 托管绑定。',
    errorCode: step?.errorCode,
    failureReason: step?.message ?? planResult.nextAction,
    suggestion: planResult.nextAction,
    rollbackStatus: step?.rollbackStatus ?? 'not_needed'
  };
}

function dryRunResourceResult(candidate: PreparedKitResource, planResult: PlanResult, kitId: string, target: KitApplicationTargetRecord): ResourceChangeResult {
  const step = stepResultFor(planResult, candidate.stepId);
  return {
    resourceRefId: candidate.resolution.ref.refId,
    resourceId: candidate.resolution.row.resource.id,
    bindingId: candidate.resolution.row.binding?.id,
    resourceType: candidate.resolution.ref.resourceType,
    agentId: target.agentId,
    projectId: target.projectId,
    kitId,
    targetPath: candidate.targetPath,
    status: 'dry_run',
    message: step?.message ?? 'Dry run completed; no Kit managed binding was written.',
    rollbackStatus: step?.rollbackStatus ?? 'not_needed'
  };
}

function failedPlanBindingResult(binding: ResourceBinding, kitId: string, planResult: PlanResult): ResourceChangeResult {
  const step = stepResultFor(planResult, stepIdForBinding(binding.id));
  const rolledBack = planResult.status === 'rolled_back' || step?.rollbackStatus === 'success';
  const rollbackFailed = planResult.status === 'rollback_failed' || step?.rollbackStatus === 'failed';
  return {
    resourceId: binding.resourceId,
    bindingId: binding.id,
    resourceType: binding.resourceType,
    agentId: binding.agentId,
    projectId: binding.projectId,
    kitId,
    targetPath: binding.targetPath,
    status: rollbackFailed ? 'rollback_failed' : rolledBack ? 'rolled_back' : 'failure',
    message: step?.message ?? planResult.nextAction ?? 'Kit 移除执行计划未成功，未删除 Kit 托管绑定。',
    errorCode: step?.errorCode,
    failureReason: step?.message ?? planResult.nextAction,
    suggestion: planResult.nextAction,
    rollbackStatus: step?.rollbackStatus ?? 'not_needed'
  };
}

function dryRunBindingResult(binding: ResourceBinding, kitId: string, planResult: PlanResult): ResourceChangeResult {
  const step = stepResultFor(planResult, stepIdForBinding(binding.id));
  return {
    resourceId: binding.resourceId,
    bindingId: binding.id,
    resourceType: binding.resourceType,
    agentId: binding.agentId,
    projectId: binding.projectId,
    kitId,
    targetPath: binding.targetPath,
    status: 'dry_run',
    message: step?.message ?? 'Dry run completed; no Kit managed binding was removed.',
    rollbackStatus: step?.rollbackStatus ?? 'not_needed'
  };
}

function removedBindingResult(binding: RemovedKitBinding, kitId: string, planResult: PlanResult): ResourceChangeResult {
  return {
    resourceId: binding.resourceId,
    bindingId: binding.bindingId,
    resourceType: binding.resourceType,
    agentId: binding.agentId,
    projectId: binding.projectId,
    kitId,
    targetPath: binding.targetPath,
    status: 'success',
    message: '已移除 Kit 托管绑定；未删除用户原有配置。',
    rollbackStatus: stepRollbackStatus(planResult, stepIdForBinding(binding.bindingId))
  };
}

function notKitManagedBindingResult(binding: ResourceBinding, kitId: string, planResult: PlanResult): ResourceChangeResult {
  return {
    resourceId: binding.resourceId,
    bindingId: binding.id,
    resourceType: binding.resourceType,
    agentId: binding.agentId,
    projectId: binding.projectId,
    kitId,
    targetPath: binding.targetPath,
    status: 'failure',
    message: '执行计划成功，但目标绑定不再是该 Kit 托管绑定。',
    failureReason: 'kit_managed_binding_missing',
    suggestion: '刷新应用分布后重试。',
    rollbackStatus: stepRollbackStatus(planResult, stepIdForBinding(binding.id))
  };
}

function removeBindingMaterializationFailure(binding: ResourceBinding, kitId: string, planResult: PlanResult, error: unknown): ResourceChangeResult {
  const failureReason = error instanceof Error ? error.message : 'Kit binding removal failed';
  return {
    resourceId: binding.resourceId,
    bindingId: binding.id,
    resourceType: binding.resourceType,
    agentId: binding.agentId,
    projectId: binding.projectId,
    kitId,
    targetPath: binding.targetPath,
    status: 'failure',
    message: '执行计划成功，但 Kit 托管绑定删除失败。',
    errorCode: error instanceof Error ? error.name : 'kit_binding_removal_failed',
    failureReason,
    suggestion: '查看本地执行记录和数据库删除错误后重试。',
    rollbackStatus: stepRollbackStatus(planResult, stepIdForBinding(binding.id))
  };
}

function bindingMaterializationFailure(candidate: PreparedKitResource, kitId: string, target: KitApplicationTargetRecord, error: unknown, rollbackStatus: ResourceChangeResult['rollbackStatus']): ResourceChangeResult {
  const failureReason = error instanceof Error ? error.message : 'Kit binding materialization failed';
  return {
    resourceRefId: candidate.resolution.ref.refId,
    resourceId: candidate.resolution.row.resource.id,
    bindingId: candidate.resolution.row.binding?.id,
    resourceType: candidate.resolution.ref.resourceType,
    agentId: target.agentId,
    projectId: target.projectId,
    kitId,
    targetPath: candidate.targetPath,
    status: 'failure',
    message: '执行计划成功，但 Kit 托管绑定写入失败。',
    errorCode: error instanceof Error ? error.name : 'kit_binding_materialization_failed',
    failureReason,
    suggestion: '查看本地执行记录和数据库写入错误后重试。',
    rollbackStatus
  };
}

function kitApplicationBindingFailure(manifest: KitManifest, target: KitApplicationTargetRecord, error: unknown): ResourceChangeResult {
  const failureReason = error instanceof Error ? error.message : 'Kit application binding write failed';
  return {
    resourceId: resourceIdFor(LocalResourceTypes.KIT, manifest.kitId),
    resourceType: LocalResourceTypes.KIT,
    agentId: target.agentId,
    projectId: target.projectId,
    kitId: manifest.kitId,
    targetPath: target.targetPath ?? target.scopePath,
    status: 'failure',
    message: '资源级结果已生成，但 Kit 应用汇总绑定写入失败。',
    errorCode: error instanceof Error ? error.name : 'kit_application_binding_failed',
    failureReason,
    suggestion: '查看本地执行记录和数据库写入错误后重试。',
    rollbackStatus: 'not_needed'
  };
}

function emptyKitManifestResult(manifest: KitManifest): ResourceChangeResult {
  return {
    resourceId: resourceIdFor(LocalResourceTypes.KIT, manifest.kitId),
    resourceType: LocalResourceTypes.KIT,
    kitId: manifest.kitId,
    status: 'failure',
    message: 'Kit manifest 未包含任何可应用资源。',
    failureReason: 'empty_kit_manifest',
    rollbackStatus: 'not_needed'
  };
}

function stepResultFor(planResult: PlanResult, stepId: string): StepResult | undefined {
  return planResult.steps.find((step) => step.stepId === stepId);
}

function stepRollbackStatus(planResult: PlanResult, stepId: string): ResourceChangeResult['rollbackStatus'] {
  return stepResultFor(planResult, stepId)?.rollbackStatus ?? 'not_needed';
}

function planStatusToOperationStatus(planResult: PlanResult): Phase3OperationResult['status'] {
  if (planResult.status === 'success') return 'success';
  if (planResult.status === 'dry_run') return 'dry_run';
  if (planResult.status === 'rolled_back') return 'rolled_back';
  if (planResult.status === 'rollback_failed') return 'rollback_failed';
  if (planResult.status === 'partial_success') return 'partial_success';
  return 'failure';
}

function operationMessage(status: Phase3OperationResult['status']): string {
  if (status === 'rollback_failed') return 'Rollback failed; inspect backup records before retrying.';
  if (status === 'partial_success') return 'Operation partially completed.';
  if (status === 'dry_run') return 'Dry run completed; no local metadata was written.';
  if (status === 'success') return 'Operation completed.';
  return 'Operation failed.';
}

function requireKitManifest(value: unknown, requestID?: string): KitManifest {
  const manifest = isKitManifest(value) ? value : extractKitManifest(value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined);
  if (!manifest) {
    throw new DesktopErrorException(makeDesktopError('validation_failed', 'Kit import requires a valid KitManifest.', requestID));
  }
  return manifest;
}

function normalizeTarget(input: KitApplicationTargetInput, requestID?: string): KitApplicationTargetRecord {
  const agentId = nonEmpty(input.agentId);
  const projectId = nonEmpty(input.projectId);
  const scopePath = nonEmpty(input.scopePath);
  const targetPath = nonEmpty(input.targetPath);
  const scopeType = input.scopeType
    ?? (agentId && projectId ? ResourceScopeTypes.AGENT_PROJECT
      : projectId ? ResourceScopeTypes.PROJECT
        : agentId ? ResourceScopeTypes.AGENT_GLOBAL
          : scopePath || targetPath ? ResourceScopeTypes.CUSTOM_PATH
            : undefined);
  if (!scopeType) {
    throw new DesktopErrorException(makeDesktopError('validation_failed', 'Kit application target requires an agent, project, or custom path scope.', requestID));
  }
  if (!Object.values(ResourceScopeTypes).includes(scopeType)) {
    throw new DesktopErrorException(makeDesktopError('validation_failed', `Invalid Kit target scopeType: ${scopeType}`, requestID));
  }
  validateTargetShape({ scopeType, agentId, projectId, scopePath, targetPath }, requestID);
  return { scopeType, agentId, projectId, scopePath, targetPath };
}

function validateTargetShape(target: KitApplicationTargetRecord, requestID?: string): void {
  const failTarget = (message: string) => {
    throw new DesktopErrorException(makeDesktopError('validation_failed', message, requestID));
  };
  if (target.scopeType === ResourceScopeTypes.AGENT_GLOBAL && !target.agentId) {
    failTarget('Kit AGENT_GLOBAL target requires agentId.');
  }
  if (target.scopeType === ResourceScopeTypes.PROJECT && !target.projectId) {
    failTarget('Kit PROJECT target requires projectId.');
  }
  if (target.scopeType === ResourceScopeTypes.AGENT_PROJECT && (!target.agentId || !target.projectId)) {
    failTarget('Kit AGENT_PROJECT target requires both agentId and projectId.');
  }
  if (target.scopeType === ResourceScopeTypes.CUSTOM_PATH && !target.scopePath && !target.targetPath) {
    failTarget('Kit CUSTOM_PATH target requires scopePath or targetPath.');
  }
  if (target.scopeType === ResourceScopeTypes.KIT) {
    failTarget('Kit application cannot target KIT scope directly.');
  }
  if (target.scopeType === ResourceScopeTypes.GLOBAL) {
    failTarget('Kit GLOBAL target is not a supported Phase 3 application scope; use AGENT_GLOBAL, PROJECT, AGENT_PROJECT, or CUSTOM_PATH.');
  }
}

function buildManifestFromRows(rows: LocalResourceRow[], input: {
  kitId: string;
  name: string;
  version?: string;
  description?: string;
  sourceType: KitManifest['sourceType'];
  supportedAgents: string[];
  metadata: Record<string, unknown>;
}, requestID?: string): KitManifest {
  if (rows.length === 0) {
    throw new DesktopErrorException(makeDesktopError('resource_not_found', 'No local resources are available to generate a Kit manifest.', requestID));
  }
  const resources: KitResourceRef[] = rows.map((row) => {
    const source = row.resource.sourceId ?? row.resource.id;
    return {
      refId: `${row.resource.type}:${source}`,
      resourceType: row.resource.type as KitResourceKind,
      resourceId: row.resource.id,
      sourcePath: row.resource.sourcePath,
      targetPath: row.binding?.targetPath,
      bindingId: row.binding?.id,
      required: true,
      metadata: {
        sourceId: row.resource.sourceId,
        name: row.resource.displayName,
        agentId: row.binding?.agentId,
        projectId: row.binding?.projectId
      }
    };
  });
  const resourceHashes = Object.fromEntries(resources.flatMap((ref, index) => {
    const hash = hashForRow(rows[index]);
    return hash ? [[ref.refId, hash]] : [];
  }));
  return {
    kitId: nonEmpty(input.kitId) ?? fail('validation_failed', 'kitId is required for generated Kit manifest.', requestID),
    name: nonEmpty(input.name) ?? fail('validation_failed', 'name is required for generated Kit manifest.', requestID),
    version: nonEmpty(input.version) ?? '1.0.0',
    description: input.description,
    sourceType: input.sourceType,
    createdAt: new Date().toISOString(),
    supportedAgents: input.supportedAgents,
    supportedPlatforms: unique(rows.flatMap((row) => [
      ...stringArray(row.resource.metadata.supportedPlatforms),
      ...stringArray(row.resource.metadata.platforms),
      nonEmpty(row.resource.metadata.platform)
    ].filter((value): value is string => Boolean(value)))) as KitManifest['supportedPlatforms'],
    resources,
    permissionSummary: mergePermissions(rows),
    auditSummary: mergeAudit(rows),
    requiredAuthorizations: resources.map((resource) => ({
      resourceId: resource.resourceId ?? resource.refId,
      resourceType: resource.resourceType,
      reason: 'Kit 应用需要该资源仍处于有效授权或本地可用状态。',
      requiredStatus: AuthStatuses.AUTH_CACHE_VALID
    })),
    resourceHashes,
    dependencies: [],
    conflictPolicy: 'skip',
    rollbackPolicy: 'best-effort',
    metadata: input.metadata
  };
}

function resolveManifestResources(manifest: KitManifest, snapshot: LocalResourceSnapshot): ResolvedKitResource[] {
  return manifest.resources.map((ref) => {
    const row = snapshot.rows.find((candidate) => (
      Boolean(ref.resourceId && candidate.resource.id === ref.resourceId)
      || Boolean(ref.bindingId && candidate.binding?.id === ref.bindingId)
      || Boolean(candidate.resource.sourceId && candidate.resource.sourceId === ref.refId)
      || `${candidate.resource.type}:${candidate.resource.sourceId ?? candidate.resource.id}` === ref.refId
    ));
    const expectedHash = manifest.resourceHashes[ref.refId] ?? (ref.resourceId ? manifest.resourceHashes[ref.resourceId] : undefined);
    const actualHash = row ? hashForRow(row) : undefined;
    const hashError = expectedHash && (!actualHash || actualHash !== expectedHash)
      ? `Kit manifest Hash 与本地资源记录不一致：${ref.refId}`
      : undefined;
    return { ref, row, expectedHash, hashError };
  });
}

function detectKitDrift(manifest: KitManifest, snapshot: LocalResourceSnapshot): ResourceChangeResult[] {
  return resolveManifestResources(manifest, snapshot).flatMap((resolution) => {
    if (!resolution.row) {
      return [{
        resourceRefId: resolution.ref.refId,
        resourceType: resolution.ref.resourceType,
        kitId: manifest.kitId,
        status: resolution.ref.required ? 'failure' : 'skipped',
        message: resolution.ref.required ? '必需资源缺失。' : '可选资源缺失，已跳过。',
        failureReason: resolution.ref.required ? 'required_resource_missing' : undefined,
        rollbackStatus: 'not_needed'
      } satisfies ResourceChangeResult];
    }
    if (resolution.hashError || drifted(resolution.row)) {
      return [{
        resourceRefId: resolution.ref.refId,
        resourceId: resolution.row.resource.id,
        bindingId: resolution.row.binding?.id,
        resourceType: resolution.ref.resourceType,
        agentId: resolution.row.binding?.agentId,
        projectId: resolution.row.binding?.projectId,
        kitId: manifest.kitId,
        status: 'failure',
        message: resolution.hashError ?? `资源存在配置漂移：${resolution.row.binding?.driftStatus}`,
        errorCode: resolution.hashError ? 'hash_mismatch' : 'config_drift',
        failureReason: resolution.hashError ?? 'config_drift',
        suggestion: '查看资源详情后重新生成 Kit 或清理漂移。',
        rollbackStatus: 'not_needed'
      } satisfies ResourceChangeResult];
    }
    return [];
  });
}

function kitAuditInput(manifest: KitManifest, snapshot: LocalResourceSnapshot): Record<string, unknown> {
  const resolved = resolveManifestResources(manifest, snapshot);
  return {
    manifest: {
      kitId: manifest.kitId,
      name: manifest.name,
      version: manifest.version,
      sourceType: manifest.sourceType,
      supportedAgents: manifest.supportedAgents,
      supportedPlatforms: manifest.supportedPlatforms,
      resources: manifest.resources,
      permissionSummary: manifest.permissionSummary,
      resourceHashes: manifest.resourceHashes,
      dependencies: manifest.dependencies,
      conflictPolicy: manifest.conflictPolicy,
      rollbackPolicy: manifest.rollbackPolicy,
      metadata: manifest.metadata
    },
    resolvedResources: resolved.map((item) => ({
      refId: item.ref.refId,
      resourceType: item.ref.resourceType,
      required: item.ref.required,
      resolved: Boolean(item.row),
      hashError: item.hashError,
      resource: item.row ? {
        resourceId: item.row.resource.id,
        sourceId: item.row.resource.sourceId,
        sourcePath: item.row.resource.sourcePath,
        permissionSummary: item.row.resource.permissionSummary,
        auditSummary: item.row.resource.auditSummary,
        metadata: item.row.resource.metadata
      } : undefined,
      binding: item.row?.binding ? {
        bindingId: item.row.binding.id,
        agentId: item.row.binding.agentId,
        projectId: item.row.binding.projectId,
        kitId: item.row.binding.kitId,
        targetPath: item.row.binding.targetPath,
        authStatus: item.row.binding.authStatus,
        pathStatus: item.row.binding.pathStatus,
        driftStatus: item.row.binding.driftStatus,
        currentHash: item.row.binding.currentHash,
        lastKnownHash: item.row.binding.lastKnownHash,
        metadata: item.row.binding.metadata
      } : undefined
    }))
  };
}

function missingResourceResult(ref: KitResourceRef): ResourceChangeResult {
  return {
    resourceRefId: ref.refId,
    resourceType: ref.resourceType,
    status: ref.required ? 'failure' : 'skipped',
    message: ref.required ? 'Kit 必需资源在本机不存在。' : 'Kit 可选资源在本机不存在，已跳过。',
    failureReason: ref.required ? 'required_resource_missing' : undefined,
    suggestion: ref.required ? '先导入或扫描该资源，再重新应用 Kit。' : undefined,
    rollbackStatus: 'not_needed'
  };
}

function kitApplyResourceMessage(ref: KitResourceRef): string {
  if (ref.resourceType === LocalResourceTypes.HOOK || ref.resourceType === LocalResourceTypes.CLI_COMMAND) {
    return '执行计划已记录静态配置意图，并写入 Kit 托管绑定；Hook/CLI 阶段三不执行命令。';
  }
  return '执行计划已记录应用意图，并写入 Kit 托管绑定。';
}

function isStaticOnlyKitResource(resourceType: LocalResourceType | KitResourceKind): boolean {
  return resourceType === LocalResourceTypes.HOOK || resourceType === LocalResourceTypes.CLI_COMMAND;
}

function isFileBackedKitResource(resourceType: LocalResourceType | KitResourceKind): boolean {
  const fileBacked: string[] = [
    LocalResourceTypes.SKILL,
    LocalResourceTypes.MCP_SERVER,
    LocalResourceTypes.PLUGIN,
    LocalResourceTypes.RULE,
    LocalResourceTypes.MEMORY,
    LocalResourceTypes.SUBAGENT,
    LocalResourceTypes.AGENT_CONFIG,
    LocalResourceTypes.IGNORE_FILE
  ];
  return fileBacked.includes(resourceType);
}

function stepIdForResourceRef(refId: string): string {
  return `kit-resource-${safePathSegment(refId)}`;
}

function stepIdForBinding(bindingId: string): string {
  return `kit-binding-${safePathSegment(bindingId)}`;
}

function safePathSegment(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function mergePermissions(rows: LocalResourceRow[]): PermissionSummary {
  const categories = unique(rows.flatMap((row) => row.resource.permissionSummary.categories)) as PermissionCategory[];
  const items = unique(rows.flatMap((row) => row.resource.permissionSummary.items)) as PermissionItem[];
  const details = rows.flatMap((row) => row.resource.permissionSummary.details);
  if (categories.length === 0 && items.length === 0) return createEmptyPermissionSummary('未声明');
  return {
    categories,
    items,
    label: categories.length > 0 ? categories.join(' / ') : '已声明权限',
    declared: true,
    details,
    lastExtractedAt: new Date().toISOString()
  };
}

function mergeAudit(rows: LocalResourceRow[]): AuditSummary {
  if (rows.length === 0) return createNotAuditedSummary();
  const status = worstAudit(rows.map((row) => row.resource.auditSummary.status));
  return {
    status,
    trustScore: Math.min(...rows.map((row) => row.resource.auditSummary.trustScore ?? 100)),
    findingCount: rows.reduce((sum, row) => sum + row.resource.auditSummary.findingCount, 0),
    criticalCount: rows.reduce((sum, row) => sum + row.resource.auditSummary.criticalCount, 0),
    highCount: rows.reduce((sum, row) => sum + row.resource.auditSummary.highCount, 0),
    lastAuditedAt: new Date().toISOString(),
    message: '由 Kit 包含资源聚合生成。'
  };
}

function worstAudit(statuses: AuditStatus[]): AuditStatus {
  if (statuses.includes(AuditStatuses.SECURITY_RISK)) return AuditStatuses.SECURITY_RISK;
  if (statuses.includes(AuditStatuses.HIGH_RISK)) return AuditStatuses.HIGH_RISK;
  if (statuses.includes(AuditStatuses.NEEDS_REVIEW)) return AuditStatuses.NEEDS_REVIEW;
  if (statuses.includes(AuditStatuses.LOW_RISK)) return AuditStatuses.LOW_RISK;
  if (statuses.includes(AuditStatuses.SAFE)) return AuditStatuses.SAFE;
  return AuditStatuses.NOT_AUDITED;
}

function isKitResourceKind(type: string): type is KitResourceKind {
  return [
    LocalResourceTypes.SKILL,
    LocalResourceTypes.MCP_SERVER,
    LocalResourceTypes.PLUGIN,
    LocalResourceTypes.HOOK,
    LocalResourceTypes.CLI_COMMAND,
    LocalResourceTypes.RULE,
    LocalResourceTypes.MEMORY,
    LocalResourceTypes.SUBAGENT,
    LocalResourceTypes.AGENT_CONFIG,
    LocalResourceTypes.IGNORE_FILE
  ].includes(type as KitResourceKind);
}

function hashForRow(row: LocalResourceRow): string | undefined {
  return row.binding?.currentHash
    ?? row.resource.sha256
    ?? row.resource.packageHash
    ?? row.files[0]?.currentHash
    ?? row.files[0]?.lastKnownHash;
}

function drifted(row: LocalResourceRow): boolean {
  return Boolean(row.binding?.drifted
    || row.files.some((file) => file.drifted)
    || row.binding?.driftStatus === DriftStatuses.DRIFTED
    || row.binding?.driftStatus === DriftStatuses.EXTERNALLY_MODIFIED
    || row.binding?.driftStatus === DriftStatuses.MANAGED_BLOCK_MISSING
    || row.binding?.driftStatus === DriftStatuses.HASH_CHANGED);
}

function deterministicApplicationId(kitId: string, target: KitApplicationTargetRecord): string {
  return `kit_app_${createHash('sha256').update(JSON.stringify({ kitId, target })).digest('hex').slice(0, 16)}`;
}

function resourceIdFor(type: string, sourceId: string): string {
  return `resource_${type.toLowerCase()}_${Buffer.from(sourceId).toString('base64url')}`;
}

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function required(value: string | undefined, field: string, requestID?: string): string {
  if (!value) throw new DesktopErrorException(makeDesktopError('validation_failed', `${field} is required.`, requestID));
  return value;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function fail(code: Parameters<typeof makeDesktopError>[0], message: string, requestID?: string): never {
  throw new DesktopErrorException(makeDesktopError(code, message, requestID));
}
