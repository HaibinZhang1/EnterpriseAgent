import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ExecutionPlan } from '../executor/types';
import type { AdapterManifest, AdapterMatchRequest, ToolAdapter } from './types';
import { createCapabilityMatcher } from './registry';

export class DirectoryToolAdapter implements ToolAdapter {
  manifest: AdapterManifest;

  constructor(manifest?: Partial<AdapterManifest>) {
    this.manifest = {
      adapterId: 'custom-directory',
      adapterVersion: '1.0.0',
      toolName: 'Custom Directory',
      supportedPlatforms: [process.platform, 'test'],
      defaultScanPaths: [],
      capabilities: ['symlink', 'copy', 'config-write', 'controlled-install', 'dry-run', 'rollback'],
      ...manifest
    };
  }

  /*
   * The built-in adapters share the safe directory-plan implementation while
   * carrying tool-specific identity/capability metadata for target selection.
   */
  static forKnownTool(adapterId: string, toolName: string, defaultScanPaths: string[]): DirectoryToolAdapter {
    return new DirectoryToolAdapter({ adapterId, toolName, defaultScanPaths });
  }

  canHandle(request: AdapterMatchRequest): boolean {
    return this.manifest.supportedPlatforms.includes(request.platform) && createCapabilityMatcher([...this.manifest.capabilities], request.requiredCapabilities);
  }

  async buildPlan(input: unknown): Promise<ExecutionPlan> {
    const record = input as { operation?: string; targetPath: string; content?: string; dryRun?: boolean };
    const now = new Date().toISOString();
    return {
      planId: `plan_${randomUUID()}`,
      operation: record.operation ?? 'adapter.write',
      createdAt: now,
      dryRun: record.dryRun ?? true,
      riskLevel: 'LOW',
      summary: { title: 'Custom directory adapter plan', description: `Write ${path.basename(record.targetPath)}`, targetCount: 1, warnings: [] },
      preconditions: [],
      steps: [{ stepId: 'write-config', action: 'write-file', description: 'Write managed config', targetPath: record.targetPath, content: record.content ?? '{}', rollbackable: true, managed: true }],
      rollbackPolicy: { strategy: 'best-effort' },
      idempotencyKey: `adapter:${record.targetPath}:${now}`
    };
  }
}

export function createDryRunAdapters(): DirectoryToolAdapter[] {
  const home = os.homedir();
  return [
    new DirectoryToolAdapter(),
    DirectoryToolAdapter.forKnownTool('codex', 'Codex', [path.join(home, '.codex')]),
    DirectoryToolAdapter.forKnownTool('claude', 'Claude', [path.join(home, '.claude')]),
    DirectoryToolAdapter.forKnownTool('cursor', 'Cursor', [path.join(home, '.cursor')]),
    DirectoryToolAdapter.forKnownTool('windsurf', 'Windsurf', [path.join(home, '.codeium', 'windsurf')]),
    DirectoryToolAdapter.forKnownTool('opencode', 'opencode', [path.join(home, '.opencode')])
  ];
}
