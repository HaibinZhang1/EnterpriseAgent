import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ExecutionPlan, PlanStep } from '../executor/types';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

export type PluginInstallMode = 'MANAGED_PACKAGE' | 'CONFIG_PLUGIN' | 'MANUAL_DOWNLOAD';

export interface PluginPlanInput {
  extensionId: string;
  version: string;
  installMode: PluginInstallMode;
  targetPath: string;
  packagePath?: string;
  expectedSha256?: string;
  operation?: 'install' | 'enable' | 'disable' | 'update' | 'uninstall' | 'mark-installed' | 'mark-uninstalled';
  manifest?: { actions?: Array<{ action: string; source?: string; target?: string; content?: string }> };
  manualInstructions?: string;
  manualInstructionsUrl?: string;
  dryRun?: boolean;
  requestID?: string;
}

export class PluginService {
  createPlan(input: PluginPlanInput): ExecutionPlan {
    const now = new Date().toISOString();
    const steps = this.steps(input);
    return {
      planId: `plugin_plan_${randomUUID()}`,
      requestId: input.requestID,
      operation: `PLUGIN_${input.installMode}`,
      extensionId: input.extensionId,
      version: input.version,
      createdAt: now,
      dryRun: input.dryRun ?? true,
      riskLevel: input.installMode === 'MANUAL_DOWNLOAD' ? 'LOW' : 'MEDIUM',
      summary: { title: 'Plugin local action', description: `Prepare ${input.installMode} for ${input.extensionId}`, targetCount: steps.length, warnings: input.installMode === 'MANUAL_DOWNLOAD' ? ['manual-download does not auto-install'] : [] },
      preconditions: [],
      steps,
      rollbackPolicy: { strategy: 'best-effort' },
      idempotencyKey: `plugin:${input.extensionId}:${input.version}:${input.installMode}:${input.operation ?? 'install'}:${input.targetPath}`
    };
  }

  private steps(input: PluginPlanInput): PlanStep[] {
    if (input.installMode === 'MANUAL_DOWNLOAD') {
      return [
        {
          stepId: 'open-manual-instructions',
          action: 'record-state',
          description: 'Surface manual installation instructions',
          targetPath: path.join(input.targetPath, `${input.extensionId}.manual-instructions.json`),
          content: JSON.stringify({
            extensionId: input.extensionId,
            version: input.version,
            instructions: input.manualInstructions ?? 'Follow the publisher manual installation instructions for this Plugin.',
            instructionsUrl: input.manualInstructionsUrl,
            controlledBy: 'Enterprise Agent Hub'
          }),
          rollbackable: true,
          managed: true
        },
        {
          stepId: 'record-manual-download',
          action: 'record-state',
          description: 'Record manual-download state only',
          targetPath: path.join(input.targetPath, `${input.extensionId}.manual.json`),
          content: JSON.stringify({ installed: input.operation === 'mark-installed', manual: true, operation: input.operation ?? 'download' }),
          rollbackable: true,
          managed: true
        }
      ];
    }
    if (input.operation === 'uninstall') {
      return [{ stepId: 'remove-managed-plugin', action: 'remove-managed', description: 'Remove managed plugin content', targetPath: path.join(input.targetPath, input.extensionId), rollbackable: true, managed: true }];
    }
    if (input.installMode === 'CONFIG_PLUGIN') {
      return [{ stepId: 'write-plugin-config', action: 'write-file', description: 'Write managed plugin config', targetPath: path.join(input.targetPath, `${input.extensionId}.json`), content: JSON.stringify(input.manifest ?? {}), rollbackable: true, managed: true }];
    }
    return (input.manifest?.actions ?? [{ action: 'copy', source: input.packagePath, target: input.extensionId }]).map((action, index) => this.mapAction(input, action, index));
  }

  private mapAction(input: PluginPlanInput, action: { action: string; source?: string; target?: string; content?: string }, index: number): PlanStep {
    if (action.action === 'copy') {
      return { stepId: `copy-${index}`, action: 'copy-file', description: 'Copy managed plugin file', sourcePath: action.source ?? input.packagePath, targetPath: path.join(input.targetPath, action.target ?? input.extensionId), expectedSha256: input.expectedSha256, rollbackable: true, managed: true };
    }
    if (action.action === 'write-config') {
      return { stepId: `config-${index}`, action: 'write-file', description: 'Write managed plugin config', targetPath: path.join(input.targetPath, action.target ?? `${input.extensionId}.json`), content: action.content ?? '{}', rollbackable: true, managed: true };
    }
    if (action.action === 'remove') {
      return { stepId: `remove-${index}`, action: 'remove-managed', description: 'Remove managed plugin item', targetPath: path.join(input.targetPath, action.target ?? input.extensionId), rollbackable: true, managed: true };
    }
    throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', `Unsupported plugin manifest action ${action.action}`, input.requestID));
  }
}
