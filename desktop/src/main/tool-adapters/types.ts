import type { ExecutionPlan } from '../executor/types';

export type ExtensionKind = 'skill' | 'mcp' | 'plugin';
export type AdapterCapability = 'symlink' | 'copy' | 'config-write' | 'controlled-install' | 'connection-test' | 'dry-run' | 'rollback';
export type AgentAdapterCapability =
  | 'detect'
  | 'global-scope'
  | 'project-scope'
  | 'custom-path'
  | 'settings-read'
  | 'ignore-file'
  | 'file-preview'
  | 'rules'
  | 'memory'
  | 'subagents'
  | 'skills'
  | 'mcp'
  | 'plugins'
  | 'hooks'
  | 'cli'
  | 'permission-extract'
  | 'static-audit'
  | 'backup'
  | 'rollback';

export interface AgentPathProfile {
  platform: 'macos' | 'windows' | 'linux' | 'test';
  detectionRoots: string[];
  globalResourcePaths: string[];
  projectResourcePaths: string[];
  fallbackRoot?: string;
  sourceLevel?: 'OFFICIAL_VERIFIED' | 'PRODUCT_DOC_UNSTRUCTURED' | 'DOC_OR_COMMUNITY_VERIFIED' | 'EA_MANAGED' | 'NOT_APPLICABLE' | 'USER_CONFIG_REQUIRED';
}

export interface AgentAdapterManifest {
  agentId: string;
  displayName: string;
  adapterVersion: string;
  supportedPlatforms: string[];
  builtIn: boolean;
  customProfileSupported: boolean;
  capabilities: AgentAdapterCapability[];
  macosPathProfile?: AgentPathProfile;
  windowsPathProfile?: AgentPathProfile;
}

export interface AdapterManifest {
  adapterId: string;
  adapterVersion: string;
  toolName: string;
  supportedPlatforms: string[];
  defaultScanPaths: string[];
  capabilities: AdapterCapability[];
  agentAdapter?: AgentAdapterManifest;
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
