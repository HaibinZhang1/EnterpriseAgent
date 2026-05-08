import type { ExecutionPlan } from '../executor/types';

export type ExtensionKind = 'skill' | 'mcp' | 'plugin';
export type AdapterCapability = 'symlink' | 'copy' | 'config-write' | 'controlled-install' | 'connection-test' | 'dry-run' | 'rollback';

export interface AdapterManifest {
  adapterId: string;
  adapterVersion: string;
  toolName: string;
  supportedPlatforms: string[];
  defaultScanPaths: string[];
  capabilities: AdapterCapability[];
  skillTargetRules?: Record<string, unknown>;
  mcpConfigRules?: Record<string, unknown>;
  pluginTargetRules?: Record<string, unknown>;
}

export interface AdapterMatchRequest {
  extensionKind: ExtensionKind;
  requiredCapabilities: AdapterCapability[];
  platform: string;
}

export interface ToolAdapter {
  manifest: AdapterManifest;
  canHandle(request: AdapterMatchRequest): boolean;
  buildPlan(input: unknown): Promise<ExecutionPlan>;
}
