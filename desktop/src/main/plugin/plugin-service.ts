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
  manifest?: { actions?: Array<{ action: string; source?: string; target?: string; content?: string; expectedSha256?: string }> };
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
      operation: pluginOperation(input),
      extensionId: input.extensionId,
      version: input.version,
      createdAt: now,
      dryRun: input.dryRun ?? true,
      riskLevel: input.installMode === 'MANUAL_DOWNLOAD' ? 'LOW' : 'MEDIUM',
      summary: { title: 'Plugin local action', description: `Prepare ${input.installMode} for ${input.extensionId}`, targetCount: steps.length, warnings: pluginWarnings(input) },
      preconditions: [],
      steps,
      rollbackPolicy: { strategy: 'best-effort' },
      idempotencyKey: `plugin:${input.extensionId}:${input.version}:${input.installMode}:${input.operation ?? 'install'}:${input.targetPath}`
    };
  }

  private steps(input: PluginPlanInput): PlanStep[] {
    if (input.operation === 'enable' || input.operation === 'disable') {
      return [{
        stepId: `record-plugin-${input.operation}`,
        action: 'record-state',
        description: `Record managed plugin ${input.operation} state`,
        targetPath: path.join(input.targetPath, `${input.extensionId}.state.json`),
        content: JSON.stringify({
          extensionId: input.extensionId,
          version: input.version,
          enabled: input.operation === 'enable',
          operation: input.operation,
          managedBy: 'Enterprise Agent Hub'
        }, null, 2),
        rollbackable: true,
        managed: true
      }];
    }
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
            downloadedPackagePath: input.packagePath,
            expectedSha256: input.expectedSha256,
            controlledBy: 'Enterprise Agent Hub'
          }),
          rollbackable: true,
          managed: true
        },
        {
          stepId: 'record-manual-download',
          action: 'record-state',
          description: 'Record controlled manual-download state only',
          targetPath: path.join(input.targetPath, `${input.extensionId}.manual.json`),
          content: JSON.stringify({ installed: input.operation === 'mark-installed', manual: true, controlledDownload: Boolean(input.packagePath), packagePath: input.packagePath, expectedSha256: input.expectedSha256, operation: input.operation ?? 'download' }),
          rollbackable: true,
          managed: true
        }
      ];
    }
    if (input.operation === 'uninstall') {
      return [{ stepId: 'remove-managed-plugin', action: 'remove-managed', description: 'Remove managed plugin content', targetPath: path.join(input.targetPath, input.extensionId), rollbackable: true, managed: true }];
    }
    if (input.installMode === 'CONFIG_PLUGIN') {
      return [{ stepId: 'write-plugin-config', action: 'json-upsert', description: 'Upsert managed plugin config', targetPath: path.join(input.targetPath, 'plugins.json'), content: JSON.stringify({ extensionId: input.extensionId, version: input.version, manifest: input.manifest ?? {} }), rollbackable: true, managed: true, metadata: { managedConfigId: `eah_plugin_${input.extensionId}` } }];
    }
    return (input.manifest?.actions ?? [{ action: 'copy', source: input.packagePath, target: input.extensionId }]).map((action, index) => this.mapAction(input, action, index));
  }

  private mapAction(input: PluginPlanInput, action: { action: string; source?: string; target?: string; content?: string; expectedSha256?: string }, index: number): PlanStep {
    if (action.action === 'copy') {
      return { stepId: `copy-${index}`, action: 'copy-file', description: 'Copy managed plugin file', sourcePath: action.source ?? input.packagePath, targetPath: path.join(input.targetPath, action.target ?? input.extensionId), expectedSha256: input.expectedSha256, rollbackable: true, managed: true };
    }
    if (action.action === 'write-config' || action.action === 'write-json') {
      return { stepId: `config-${index}`, action: 'write-file', description: 'Write managed plugin config', targetPath: path.join(input.targetPath, action.target ?? `${input.extensionId}.json`), content: action.content ?? '{}', rollbackable: true, managed: true };
    }
    if (action.action === 'upsert-json') {
      return { stepId: `upsert-${index}`, action: 'json-upsert', description: 'Upsert managed plugin JSON config', targetPath: path.join(input.targetPath, action.target ?? 'plugins.json'), content: action.content ?? '{}', rollbackable: true, managed: true, metadata: { managedConfigId: `eah_plugin_${input.extensionId}_${index}` } };
    }
    if (action.action === 'create-dir') {
      return { stepId: `dir-${index}`, action: 'ensure-dir', description: 'Create managed plugin directory', targetPath: path.join(input.targetPath, action.target ?? input.extensionId), rollbackable: false, riskLevel: 'LOW', managed: true };
    }
    if (action.action === 'verify-hash') {
      return { stepId: `hash-${index}`, action: 'verify-hash', description: 'Verify managed plugin package hash', sourcePath: action.source ?? input.packagePath, expectedSha256: action.expectedSha256 ?? input.expectedSha256, rollbackable: false, riskLevel: 'LOW', managed: true };
    }
    if (action.action === 'mark-state') {
      return { stepId: `state-${index}`, action: 'record-state', description: 'Record managed plugin state', targetPath: path.join(input.targetPath, action.target ?? `${input.extensionId}.state.json`), content: action.content ?? JSON.stringify({ extensionId: input.extensionId, version: input.version }), rollbackable: true, managed: true };
    }
    if (action.action === 'remove') {
      return { stepId: `remove-${index}`, action: 'remove-managed', description: 'Remove managed plugin item', targetPath: path.join(input.targetPath, action.target ?? input.extensionId), rollbackable: true, managed: true };
    }
    throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', `Unsupported plugin manifest action ${action.action}`, input.requestID));
  }
}

function pluginOperation(input: PluginPlanInput): string {
  if (input.operation === 'enable') return 'PLUGIN_ENABLE';
  if (input.operation === 'disable') return 'PLUGIN_DISABLE';
  if (input.operation === 'update') return 'PLUGIN_UPDATE';
  if (input.installMode === 'MANUAL_DOWNLOAD') {
    if (input.operation === 'mark-installed') return 'PLUGIN_MANUAL_MARK_INSTALLED';
    if (input.operation === 'mark-uninstalled') return 'PLUGIN_MANUAL_MARK_UNINSTALLED';
    return 'PLUGIN_MANUAL_CONTROLLED_DOWNLOAD';
  }
  if (input.operation === 'uninstall') return 'PLUGIN_UNINSTALL';
  if (input.installMode === 'CONFIG_PLUGIN') return 'PLUGIN_CONFIG_WRITE';
  return 'PLUGIN_INSTALL';
}

function pluginWarnings(input: PluginPlanInput): string[] {
  const warnings: string[] = [];
  if (input.installMode === 'MANUAL_DOWNLOAD') warnings.push('manual-download uses controlled download and does not auto-install');
  if (input.installMode !== 'MANUAL_DOWNLOAD' && !input.packagePath && !['enable', 'disable', 'uninstall'].includes(input.operation ?? '')) warnings.push('package path must be supplied before non-dry-run managed plugin install');
  return warnings;
}
