import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppPaths } from '../config/app-paths';
import type { ExecutionPlan } from '../executor/types';

export interface SkillPlanInput {
  extensionId: string;
  version: string;
  packagePath?: string;
  expectedSha256?: string;
  targetPath: string;
  dryRun?: boolean;
  requestID?: string;
}

export interface OfflineSkillEnableContext {
  installed: boolean;
  hasValidAuthorizationCache: boolean;
  scopesMatch: boolean;
  scopeReduced?: boolean;
  delisted?: boolean;
  securityRisk?: boolean;
}

export function canEnableInstalledSkillOffline(context: OfflineSkillEnableContext): boolean {
  return context.installed && context.hasValidAuthorizationCache && context.scopesMatch
    && !context.scopeReduced && !context.delisted && !context.securityRisk;
}

export class SkillService {
  constructor(private readonly paths: AppPaths) {}

  createInstallPlan(input: SkillPlanInput): ExecutionPlan {
    const now = new Date().toISOString();
    const versionDir = path.join(this.paths.centralStoreSkillsDir, input.extensionId, input.version);
    const packageTarget = path.join(versionDir, 'package');
    return {
      planId: `skill_plan_${randomUUID()}`,
      requestId: input.requestID,
      operation: 'SKILL_INSTALL',
      extensionId: input.extensionId,
      version: input.version,
      createdAt: now,
      dryRun: input.dryRun ?? true,
      riskLevel: 'MEDIUM',
      summary: { title: 'Install Skill', description: `Install ${input.extensionId}@${input.version} into Central Store`, targetCount: 3, warnings: [] },
      preconditions: [{ id: 'package-present', description: 'Downloaded package path is required before local install', satisfied: Boolean(input.packagePath), errorCode: 'download_ticket_required' }],
      steps: [
        { stepId: 'ensure-version-dir', action: 'ensure-dir', description: 'Ensure Central Store version directory exists', targetPath: versionDir, rollbackable: false, riskLevel: 'LOW' },
        { stepId: 'copy-package', action: 'copy-file', description: 'Copy verified Skill package into Central Store', sourcePath: input.packagePath, targetPath: packageTarget, expectedSha256: input.expectedSha256, rollbackable: true, managed: true },
        { stepId: 'switch-current-version', action: 'switch-pointer', description: 'Switch current version pointer', targetPath: path.join(this.paths.centralStoreSkillsDir, input.extensionId, 'current.json'), content: JSON.stringify({ version: input.version, packagePath: packageTarget }, null, 2), rollbackable: true, managed: true }
      ],
      rollbackPolicy: { strategy: 'best-effort' },
      idempotencyKey: `skill:${input.extensionId}:${input.version}:install`
    };
  }

  createEnablePlan(input: SkillPlanInput): ExecutionPlan {
    const now = new Date().toISOString();
    const source = input.packagePath ?? path.join(this.paths.centralStoreSkillsDir, input.extensionId, input.version);
    return {
      planId: `skill_plan_${randomUUID()}`,
      requestId: input.requestID,
      operation: 'SKILL_ENABLE',
      extensionId: input.extensionId,
      version: input.version,
      createdAt: now,
      dryRun: input.dryRun ?? true,
      riskLevel: 'MEDIUM',
      summary: { title: 'Enable Skill', description: `Enable ${input.extensionId} for selected target`, targetCount: 1, warnings: [] },
      preconditions: [],
      steps: [
        { stepId: 'ensure-target', action: 'ensure-dir', description: 'Ensure target directory exists', targetPath: input.targetPath, rollbackable: false, riskLevel: 'LOW' },
        { stepId: 'link-skill', action: 'symlink', description: 'Link managed Skill into target', sourcePath: source, targetPath: path.join(input.targetPath, input.extensionId), rollbackable: true, managed: true }
      ],
      rollbackPolicy: { strategy: 'best-effort' },
      idempotencyKey: `skill:${input.extensionId}:${input.version}:enable:${input.targetPath}`
    };
  }

  createCopyFallbackPlan(input: SkillPlanInput): ExecutionPlan {
    const plan = this.createEnablePlan(input);
    return { ...plan, summary: { ...plan.summary, warnings: [...plan.summary.warnings, 'symlink failed; copy fallback selected'] }, steps: plan.steps.map((step) => step.stepId === 'link-skill' ? { ...step, action: 'copy-file', description: 'Copy managed Skill into target', metadata: { fallbackFrom: 'symlink' } } : step) };
  }

  createDisablePlan(input: SkillPlanInput): ExecutionPlan {
    const plan = this.createUninstallPlan({ ...input, dryRun: input.dryRun ?? true });
    return {
      ...plan,
      operation: 'SKILL_DISABLE',
      summary: { ...plan.summary, title: 'Disable Skill', description: `Disable managed Skill ${input.extensionId}` },
      idempotencyKey: `skill:${input.extensionId}:${input.version}:disable:${input.targetPath}`
    };
  }

  createUpdatePlan(input: SkillPlanInput): ExecutionPlan {
    const plan = this.createInstallPlan(input);
    return {
      ...plan,
      operation: 'SKILL_UPDATE',
      summary: { title: 'Update Skill', description: `Update ${input.extensionId} to ${input.version}`, targetCount: plan.steps.length, warnings: ['current-version pointer is backed up before switching'] },
      idempotencyKey: `skill:${input.extensionId}:${input.version}:update`
    };
  }

  createUninstallPlan(input: SkillPlanInput): ExecutionPlan {
    const now = new Date().toISOString();
    const target = path.join(input.targetPath, input.extensionId);
    return {
      planId: `skill_plan_${randomUUID()}`,
      requestId: input.requestID,
      operation: 'SKILL_UNINSTALL',
      extensionId: input.extensionId,
      version: input.version,
      createdAt: now,
      dryRun: input.dryRun ?? true,
      riskLevel: 'MEDIUM',
      summary: { title: 'Uninstall Skill', description: `Remove managed Skill ${input.extensionId}`, targetCount: 1, warnings: [] },
      preconditions: [],
      steps: [{ stepId: 'remove-managed-skill', action: 'remove-managed', description: 'Remove managed Skill target', targetPath: target, rollbackable: true, managed: true }],
      rollbackPolicy: { strategy: 'best-effort' },
      idempotencyKey: `skill:${input.extensionId}:${input.version}:uninstall:${input.targetPath}`
    };
  }
}
