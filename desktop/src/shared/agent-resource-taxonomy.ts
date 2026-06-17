import {
  LocalResourceTypes,
  type LocalResourceType
} from './local-resources';

export interface AgentConfigBrowserSection {
  id: string;
  label: string;
  resourceTypes: readonly LocalResourceType[];
}

export const AGENT_RESOURCE_KINDS = [
  'settings',
  'rules',
  'memory',
  'subagents',
  'ignore-files',
  'skills',
  'mcp',
  'plugins',
  'hooks',
  'cli',
  'files'
] as const;

export const AGENT_CONFIG_BROWSER_SECTIONS = [
  { id: 'settings', label: '设置', resourceTypes: [LocalResourceTypes.AGENT_CONFIG] },
  { id: 'rules', label: '规则', resourceTypes: [LocalResourceTypes.RULE] },
  { id: 'subagents', label: '子智能体', resourceTypes: [LocalResourceTypes.SUBAGENT] },
  { id: 'memory', label: '记忆', resourceTypes: [LocalResourceTypes.MEMORY] },
  { id: 'ignore-files', label: 'Ignore Files', resourceTypes: [LocalResourceTypes.IGNORE_FILE] }
] as const satisfies ReadonlyArray<AgentConfigBrowserSection>;

export const AGENT_EXTENSION_RESOURCE_TYPES = [
  LocalResourceTypes.SKILL,
  LocalResourceTypes.MCP_SERVER,
  LocalResourceTypes.PLUGIN,
  LocalResourceTypes.HOOK,
  LocalResourceTypes.CLI_COMMAND
] as const satisfies readonly LocalResourceType[];

const AGENT_FILE_BROWSER_RESOURCE_TYPES = [
  LocalResourceTypes.AGENT_CONFIG,
  LocalResourceTypes.RULE,
  LocalResourceTypes.MEMORY,
  LocalResourceTypes.SUBAGENT,
  LocalResourceTypes.IGNORE_FILE,
  ...AGENT_EXTENSION_RESOURCE_TYPES
] as const satisfies readonly LocalResourceType[];

export const AGENT_RESOURCE_KIND_RESOURCE_TYPES = {
  settings: [LocalResourceTypes.AGENT_CONFIG],
  rules: [LocalResourceTypes.RULE],
  memory: [LocalResourceTypes.MEMORY],
  subagents: [LocalResourceTypes.SUBAGENT],
  'ignore-files': [LocalResourceTypes.IGNORE_FILE],
  skills: [LocalResourceTypes.SKILL],
  mcp: [LocalResourceTypes.MCP_SERVER],
  plugins: [LocalResourceTypes.PLUGIN],
  hooks: [LocalResourceTypes.HOOK],
  cli: [LocalResourceTypes.CLI_COMMAND],
  files: AGENT_FILE_BROWSER_RESOURCE_TYPES
} as const satisfies Record<string, readonly LocalResourceType[]>;

export function resourceTypesForAgentResourceKind(kind: string): readonly LocalResourceType[] {
  return AGENT_RESOURCE_KIND_RESOURCE_TYPES[kind as keyof typeof AGENT_RESOURCE_KIND_RESOURCE_TYPES] ?? [];
}
