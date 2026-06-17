import os from 'node:os';
import path from 'node:path';
import type {
  AgentAdapterCapability,
  AgentAdapterManifest,
  AgentCapabilityStatus,
  AgentPathProfile,
  AgentPathProfileSourceLevel,
  AgentResourceKind
} from '../tool-adapters/types';

export const BUILT_IN_AGENT_IDS = [
  'claude-code',
  'codex',
  'gemini-cli',
  'cursor',
  'antigravity',
  'copilot',
  'windsurf',
  'opencode',
  'hermes'
] as const;

export const CUSTOM_AGENT_ID = 'custom-directory';

export type BuiltInAgentId = typeof BUILT_IN_AGENT_IDS[number];
export type AgentCatalogId = BuiltInAgentId | typeof CUSTOM_AGENT_ID;
export type AgentProfilePlatform = 'macos' | 'windows';

export interface AgentPathProfileInput {
  platform: AgentProfilePlatform;
  homeDir?: string;
  userProfileDir?: string;
  projectRoot?: string;
  env?: Record<string, string | undefined>;
}

export interface CustomAgentProfile {
  profileId: string;
  agentId: string;
  displayName: string;
  supportedPlatforms: AgentProfilePlatform[];
  rootPaths: string[];
  pathProfile: AgentPathProfile;
  capabilities: AgentAdapterCapability[];
  createdByUser: boolean;
  lastValidatedAt?: string;
}

export interface CustomAgentProfileValidationResult {
  valid: boolean;
  errors: string[];
  normalized?: CustomAgentProfile;
}

export interface CustomAgentProfilesValidationResult {
  valid: boolean;
  errors: string[];
  normalized: CustomAgentProfile[];
}

const COMMON_CAPABILITIES: AgentAdapterCapability[] = [
  'detect',
  'global-scope',
  'project-scope',
  'custom-path',
  'settings-read',
  'ignore-file',
  'file-preview',
  'rules',
  'memory',
  'subagents',
  'skills',
  'mcp',
  'plugins',
  'hooks',
  'cli',
  'permission-extract',
  'static-audit',
  'backup',
  'rollback'
];

const ALL_RESOURCE_KINDS: AgentResourceKind[] = [
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
];

const fallbackKinds = ['skills', 'mcp', 'plugins', 'hooks', 'cli'] as AgentResourceKind[];

export function listBuiltInAgentManifests(): AgentAdapterManifest[] {
  return BUILT_IN_AGENT_IDS.map((agentId) => buildManifest(agentId));
}

export function listAgentCatalog(customProfiles: readonly CustomAgentProfile[] = []): AgentAdapterManifest[] {
  const customManifests = customProfiles.map(buildCustomAgentManifest);
  return [
    ...listBuiltInAgentManifests(),
    ...(customManifests.length > 0 ? customManifests : [customProfileManifest()])
  ];
}

export function getBuiltInAgentManifest(agentId: BuiltInAgentId): AgentAdapterManifest {
  return buildManifest(agentId);
}

export function getAgentManifest(agentId: AgentCatalogId): AgentAdapterManifest | undefined {
  return listAgentCatalog().find((manifest) => manifest.agentId === agentId);
}

export function resolveAgentPathProfile(profile: AgentPathProfile, input: AgentPathProfileInput): AgentPathProfile {
  const env = input.env ?? process.env;
  const home = input.homeDir ?? os.homedir();
  const userProfile = input.userProfileDir ?? home;
  const projectRoot = input.projectRoot;
  const overrideRoot = firstDefined(profile.envOverrides?.map((key) => env[key]));
  const replacements: Record<string, string> = {
    '${HOME}': home,
    '%USERPROFILE%': userProfile,
    '<agentId>': inferAgentIdFromFallback(profile.fallbackRoot) ?? '<agentId>'
  };
  if (projectRoot) replacements['<project>'] = projectRoot;
  const defaultRoots = profile.detectionRoots
    .map((item) => replacePathTokens(item, replacements, input.platform))
    .filter((item) => !item.includes('<project>'));
  const rewriteProfilePath = (value: string) => replaceAgentRootPrefix(replacePathTokens(value, replacements, input.platform), defaultRoots, overrideRoot, input.platform);
  return {
    ...profile,
    detectionRoots: profile.detectionRoots.map(rewriteProfilePath),
    globalResourcePaths: profile.globalResourcePaths.map(rewriteProfilePath),
    projectResourcePaths: profile.projectResourcePaths.map((item) => replacePathTokens(item, replacements, input.platform)),
    fallbackRoot: profile.fallbackRoot ? replacePathTokens(profile.fallbackRoot, replacements, input.platform) : undefined,
    resourcePaths: Object.fromEntries(Object.entries(profile.resourcePaths ?? {}).map(([key, values]) => [
      key,
      values?.map((item) => {
        const replaced = replacePathTokens(item, replacements, input.platform);
        return item.includes('<project>') ? replaced : replaceAgentRootPrefix(replaced, defaultRoots, overrideRoot, input.platform);
      }) ?? []
    ])) as Partial<Record<AgentResourceKind, string[]>>
  };
}

export function buildCustomAgentManifest(profile: CustomAgentProfile): AgentAdapterManifest {
  const agentId = normalizeAgentId(profile.agentId);
  if (!agentId || agentId === CUSTOM_AGENT_ID || BUILT_IN_AGENT_IDS.includes(agentId as BuiltInAgentId)) {
    throw new Error(`invalid custom Agent Profile agentId: ${profile.agentId}`);
  }
  const macosPathProfile = customPathProfileForPlatform(profile, 'macos');
  const windowsPathProfile = customPathProfileForPlatform(profile, 'windows');
  return {
    agentId,
    displayName: profile.displayName || '自定义目录',
    adapterVersion: '2.0.0',
    supportedPlatforms: [...new Set([...profile.supportedPlatforms, 'test'])],
    builtIn: false,
    customProfileSupported: true,
    capabilities: profile.capabilities?.length ? [...profile.capabilities] : [...COMMON_CAPABILITIES],
    macosPathProfile,
    windowsPathProfile,
    pathProfileVersion: '2026-06-local-agent-profile',
    defaultWriteMode: 'execution-plan-required'
  };
}

export function normalizeCustomAgentProfiles(value: unknown): CustomAgentProfilesValidationResult {
  if (value === undefined || value === null) return { valid: true, errors: [], normalized: [] };
  if (!Array.isArray(value)) return { valid: false, errors: ['agentProfiles must be an array'], normalized: [] };
  const normalized: CustomAgentProfile[] = [];
  const errors: string[] = [];
  const seenProfileIds = new Map<string, number>();
  const seenAgentIds = new Map<string, number>();
  for (const [index, item] of value.entries()) {
    const validation = validateCustomAgentProfile(item as Partial<CustomAgentProfile>);
    if (validation.normalized) {
      const profileId = normalizeAgentId(validation.normalized.profileId);
      const agentId = normalizeAgentId(validation.normalized.agentId);
      if (seenProfileIds.has(profileId)) {
        errors.push(`agentProfiles[${index}].profileId ${profileId} duplicates agentProfiles[${seenProfileIds.get(profileId)}]`);
      } else {
        seenProfileIds.set(profileId, index);
      }
      if (seenAgentIds.has(agentId)) {
        errors.push(`agentProfiles[${index}].agentId ${agentId} duplicates agentProfiles[${seenAgentIds.get(agentId)}]`);
      } else {
        seenAgentIds.set(agentId, index);
      }
      normalized.push(validation.normalized);
    }
    if (!validation.valid) errors.push(...validation.errors.map((error) => `agentProfiles[${index}].${error}`));
  }
  return {
    valid: errors.length === 0,
    errors,
    normalized
  };
}

export function validateCustomAgentProfile(input: Partial<CustomAgentProfile>, existingAgentIds: readonly string[] = BUILT_IN_AGENT_IDS): CustomAgentProfileValidationResult {
  const errors: string[] = [];
  const agentId = normalizeAgentId(input.agentId ?? '');
  const profileId = normalizeAgentId(input.profileId ?? '');
  if (!agentId) errors.push('agentId is required');
  if (agentId && existingAgentIds.includes(agentId)) errors.push(`agentId ${agentId} already exists`);
  if (agentId === CUSTOM_AGENT_ID) errors.push(`agentId ${CUSTOM_AGENT_ID} is reserved for the custom profile template`);
  if (profileId === CUSTOM_AGENT_ID) errors.push(`profileId ${CUSTOM_AGENT_ID} is reserved for the custom profile template`);
  if (!input.displayName?.trim()) errors.push('displayName is required');
  const platforms = Array.isArray(input.supportedPlatforms)
    ? input.supportedPlatforms.filter((item): item is AgentProfilePlatform => item === 'macos' || item === 'windows')
    : [];
  if (platforms.length === 0) errors.push('at least one supported platform is required');
  const rootPaths = Array.isArray(input.rootPaths) ? input.rootPaths.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean) : [];
  if (rootPaths.length === 0) errors.push('at least one root path is required');
  if (rootPaths.some((item) => item.includes('..'))) errors.push('root paths must not contain parent traversal');
  const pathProfile = input.pathProfile;
  if (!pathProfile || typeof pathProfile !== 'object' || Array.isArray(pathProfile)) {
    errors.push('pathProfile is required');
  } else {
    if (!Array.isArray(pathProfile.detectionRoots) || pathProfile.detectionRoots.length === 0) errors.push('pathProfile.detectionRoots is required');
    if (!Array.isArray(pathProfile.globalResourcePaths)) errors.push('pathProfile.globalResourcePaths is required');
    if (!Array.isArray(pathProfile.projectResourcePaths)) errors.push('pathProfile.projectResourcePaths is required');
    const resourcePaths = pathProfile.resourcePaths && typeof pathProfile.resourcePaths === 'object' && !Array.isArray(pathProfile.resourcePaths) ? pathProfile.resourcePaths : {};
    const configuredRules = Object.values(resourcePaths).flat().filter(Boolean);
    if (configuredRules.length === 0) errors.push('at least one resource path rule is required');
  }
  if (errors.length > 0 || !pathProfile || typeof pathProfile !== 'object' || Array.isArray(pathProfile)) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    normalized: {
      profileId: input.profileId?.trim() || `custom-${agentId}`,
      agentId,
      displayName: input.displayName?.trim() ?? agentId,
      supportedPlatforms: [...new Set(platforms)],
      rootPaths,
      pathProfile,
      capabilities: Array.isArray(input.capabilities) && input.capabilities.length ? input.capabilities : [...COMMON_CAPABILITIES],
      createdByUser: input.createdByUser ?? true,
      lastValidatedAt: input.lastValidatedAt
    }
  };
}

function buildManifest(agentId: BuiltInAgentId): AgentAdapterManifest {
  const definition = agentDefinitions[agentId];
  return {
    agentId,
    displayName: definition.displayName,
    adapterVersion: '2.0.0',
    supportedPlatforms: ['macos', 'windows', 'test'],
    builtIn: true,
    customProfileSupported: true,
    capabilities: [...COMMON_CAPABILITIES],
    macosPathProfile: buildProfile(agentId, 'macos', definition),
    windowsPathProfile: buildProfile(agentId, 'windows', definition),
    pathProfileVersion: '2026-06-local-agent-profile',
    defaultWriteMode: 'execution-plan-required'
  };
}

function customProfileManifest(): AgentAdapterManifest {
  return {
    agentId: CUSTOM_AGENT_ID,
    displayName: '自定义目录',
    adapterVersion: '2.0.0',
    supportedPlatforms: ['macos', 'windows', 'test'],
    builtIn: false,
    customProfileSupported: true,
    capabilities: [...COMMON_CAPABILITIES],
    macosPathProfile: customProfileTemplate('macos'),
    windowsPathProfile: customProfileTemplate('windows'),
    pathProfileVersion: '2026-06-local-agent-profile',
    defaultWriteMode: 'execution-plan-required'
  };
}

interface AgentDefinition {
  displayName: string;
  envOverrides?: string[];
  macos: ProfileSeed;
  windows: ProfileSeed;
  sourceLevels: AgentPathProfileSourceLevel[];
  fallbackKinds?: AgentResourceKind[];
}

interface ProfileSeed {
  detectionRoots: string[];
  globalResourcePaths: string[];
  projectResourcePaths: string[];
  notes?: string[];
}

const agentDefinitions: Record<BuiltInAgentId, AgentDefinition> = {
  'claude-code': {
    displayName: 'Claude Code',
    envOverrides: ['CLAUDE_CONFIG_DIR'],
    sourceLevels: ['OFFICIAL_VERIFIED'],
    macos: {
      detectionRoots: ['${HOME}/.claude'],
      globalResourcePaths: ['${HOME}/.claude/settings.json', '${HOME}/.claude/CLAUDE.md', '${HOME}/.claude/rules/*.md', '${HOME}/.claude/skills/*/SKILL.md', '${HOME}/.claude/commands/*.md', '${HOME}/.claude/agents/*.md', '${HOME}/.claude/plugins/', '${HOME}/.claude/projects/<project>/memory/'],
      projectResourcePaths: ['<project>/CLAUDE.md', '<project>/.claude/settings.json', '<project>/.claude/settings.local.json', '<project>/.claude/rules/*.md', '<project>/.claude/skills/*/SKILL.md', '<project>/.claude/commands/*.md', '<project>/.claude/agents/*.md', '<project>/.mcp.json', '<project>/.worktreeinclude'],
      notes: ['Hooks are static settings.json entries; MCP command configs are never executed.']
    },
    windows: {
      detectionRoots: ['%USERPROFILE%\\.claude'],
      globalResourcePaths: ['%USERPROFILE%\\.claude\\settings.json', '%USERPROFILE%\\.claude\\CLAUDE.md', '%USERPROFILE%\\.claude\\rules\\*.md', '%USERPROFILE%\\.claude\\skills\\*\\SKILL.md', '%USERPROFILE%\\.claude\\commands\\*.md', '%USERPROFILE%\\.claude\\agents\\*.md', '%USERPROFILE%\\.claude\\plugins\\', '%USERPROFILE%\\.claude\\projects\\<project>\\memory\\'],
      projectResourcePaths: ['<project>\\CLAUDE.md', '<project>\\.claude\\settings.json', '<project>\\.claude\\settings.local.json', '<project>\\.claude\\rules\\*.md', '<project>\\.claude\\skills\\*\\SKILL.md', '<project>\\.claude\\commands\\*.md', '<project>\\.claude\\agents\\*.md', '<project>\\.mcp.json', '<project>\\.worktreeinclude']
    }
  },
  codex: {
    displayName: 'Codex',
    envOverrides: ['CODEX_HOME'],
    sourceLevels: ['OFFICIAL_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['${HOME}/.codex'],
      globalResourcePaths: ['${HOME}/.codex/config.toml', '${HOME}/.codex/AGENTS.md', '${HOME}/.codex/<profile>.config.toml'],
      projectResourcePaths: ['<project>/.codex/config.toml', '<project>/AGENTS.md', '<project>/AGENTS.override.md']
    },
    windows: {
      detectionRoots: ['%USERPROFILE%\\.codex'],
      globalResourcePaths: ['%USERPROFILE%\\.codex\\config.toml', '%USERPROFILE%\\.codex\\AGENTS.md', '%USERPROFILE%\\.codex\\<profile>.config.toml'],
      projectResourcePaths: ['<project>\\.codex\\config.toml', '<project>\\AGENTS.md', '<project>\\AGENTS.override.md']
    }
  },
  'gemini-cli': {
    displayName: 'Gemini CLI',
    sourceLevels: ['OFFICIAL_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['${HOME}/.gemini'],
      globalResourcePaths: ['${HOME}/.gemini/settings.json', '${HOME}/.gemini/GEMINI.md', '${HOME}/.gemini/commands/*.toml'],
      projectResourcePaths: ['<project>/.gemini/settings.json', '<project>/GEMINI.md', '<project>/.gemini/commands/*.toml']
    },
    windows: {
      detectionRoots: ['%USERPROFILE%\\.gemini'],
      globalResourcePaths: ['%USERPROFILE%\\.gemini\\settings.json', '%USERPROFILE%\\.gemini\\GEMINI.md', '%USERPROFILE%\\.gemini\\commands\\*.toml'],
      projectResourcePaths: ['<project>\\.gemini\\settings.json', '<project>\\GEMINI.md', '<project>\\.gemini\\commands\\*.toml']
    }
  },
  cursor: {
    displayName: 'Cursor',
    sourceLevels: ['PRODUCT_DOC_UNSTRUCTURED', 'DOC_OR_COMMUNITY_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['<project>/.cursor', '${HOME}/.cursor'],
      globalResourcePaths: ['${HOME}/.cursor/mcp.json'],
      projectResourcePaths: ['<project>/.cursor/rules/*.mdc', '<project>/.cursor/mcp.json', '<project>/.cursorrules'],
      notes: ['Global settings are external discovery unless the user configures a path.']
    },
    windows: {
      detectionRoots: ['<project>\\.cursor', '%USERPROFILE%\\.cursor'],
      globalResourcePaths: ['%USERPROFILE%\\.cursor\\mcp.json'],
      projectResourcePaths: ['<project>\\.cursor\\rules\\*.mdc', '<project>\\.cursor\\mcp.json', '<project>\\.cursorrules']
    }
  },
  antigravity: {
    displayName: 'Antigravity',
    sourceLevels: ['DOC_OR_COMMUNITY_VERIFIED', 'OFFICIAL_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['${HOME}/.gemini', '<project>/.agent', '<project>/.agents'],
      globalResourcePaths: ['${HOME}/.gemini/GEMINI.md', '${HOME}/.gemini/antigravity/global_workflows/*.md'],
      projectResourcePaths: ['<project>/.agent/rules/', '<project>/.agent/workflows/', '<project>/AGENTS.md', '<project>/.agents/skills/*/SKILL.md']
    },
    windows: {
      detectionRoots: ['%USERPROFILE%\\.gemini', '<project>\\.agent', '<project>\\.agents'],
      globalResourcePaths: ['%USERPROFILE%\\.gemini\\GEMINI.md', '%USERPROFILE%\\.gemini\\antigravity\\global_workflows\\*.md'],
      projectResourcePaths: ['<project>\\.agent\\rules\\', '<project>\\.agent\\workflows\\', '<project>\\AGENTS.md', '<project>\\.agents\\skills\\*\\SKILL.md']
    }
  },
  copilot: {
    displayName: 'Copilot',
    sourceLevels: ['OFFICIAL_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['<project>/.github', '<project>/.vscode', '${HOME}/Library/Application Support/Code/User'],
      globalResourcePaths: ['${HOME}/Library/Application Support/Code/User/settings.json'],
      projectResourcePaths: ['<project>/.github/copilot-instructions.md', '<project>/.github/instructions/*.instructions.md', '<project>/AGENTS.md', '<project>/CLAUDE.md', '<project>/.vscode/mcp.json'],
      notes: ['VS Code user profile is external discovery unless user-configured.']
    },
    windows: {
      detectionRoots: ['<project>\\.github', '<project>\\.vscode', '%USERPROFILE%\\AppData\\Roaming\\Code\\User'],
      globalResourcePaths: ['%USERPROFILE%\\AppData\\Roaming\\Code\\User\\settings.json'],
      projectResourcePaths: ['<project>\\.github\\copilot-instructions.md', '<project>\\.github\\instructions\\*.instructions.md', '<project>\\AGENTS.md', '<project>\\CLAUDE.md', '<project>\\.vscode\\mcp.json']
    }
  },
  windsurf: {
    displayName: 'Windsurf',
    sourceLevels: ['OFFICIAL_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['<project>/.windsurf'],
      globalResourcePaths: [],
      projectResourcePaths: ['<project>/.windsurf/rules/'],
      notes: ['Global rules and memories require user-configured export paths.']
    },
    windows: {
      detectionRoots: ['<project>\\.windsurf'],
      globalResourcePaths: [],
      projectResourcePaths: ['<project>\\.windsurf\\rules\\']
    }
  },
  opencode: {
    displayName: 'OpenCode',
    envOverrides: ['OPENCODE_CONFIG_DIR'],
    sourceLevels: ['OFFICIAL_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['${HOME}/.config/opencode', '<project>/.opencode'],
      globalResourcePaths: ['${HOME}/.config/opencode/opencode.json', '${HOME}/.config/opencode/AGENTS.md', '${HOME}/.config/opencode/skills/*/SKILL.md', '${HOME}/.opencode.json'],
      projectResourcePaths: ['<project>/AGENTS.md', '<project>/CLAUDE.md', '<project>/.opencode/opencode.json', '<project>/.opencode/skills/*/SKILL.md', '<project>/.claude/skills/*/SKILL.md', '<project>/.agents/skills/*/SKILL.md']
    },
    windows: {
      detectionRoots: ['%USERPROFILE%\\.config\\opencode', '<project>\\.opencode'],
      globalResourcePaths: ['%USERPROFILE%\\.config\\opencode\\opencode.json', '%USERPROFILE%\\.config\\opencode\\AGENTS.md', '%USERPROFILE%\\.config\\opencode\\skills\\*\\SKILL.md', '%USERPROFILE%\\.opencode.json'],
      projectResourcePaths: ['<project>\\AGENTS.md', '<project>\\CLAUDE.md', '<project>\\.opencode\\opencode.json', '<project>\\.opencode\\skills\\*\\SKILL.md', '<project>\\.claude\\skills\\*\\SKILL.md', '<project>\\.agents\\skills\\*\\SKILL.md']
    }
  },
  hermes: {
    displayName: 'Hermes',
    sourceLevels: ['OFFICIAL_VERIFIED', 'EA_MANAGED'],
    macos: {
      detectionRoots: ['${HOME}/.hermes'],
      globalResourcePaths: ['${HOME}/.hermes/config.yaml', '${HOME}/.hermes/.env', '${HOME}/.hermes/auth.json', '${HOME}/.hermes/SOUL.md', '${HOME}/.hermes/memories/', '${HOME}/.hermes/skills/', '${HOME}/.hermes/cron/'],
      projectResourcePaths: ['<project>/AGENTS.md', '<project>/SOUL.md', '<project>/.cursorrules']
    },
    windows: {
      detectionRoots: ['%USERPROFILE%\\.hermes'],
      globalResourcePaths: ['%USERPROFILE%\\.hermes\\config.yaml', '%USERPROFILE%\\.hermes\\.env', '%USERPROFILE%\\.hermes\\auth.json', '%USERPROFILE%\\.hermes\\SOUL.md', '%USERPROFILE%\\.hermes\\memories\\', '%USERPROFILE%\\.hermes\\skills\\', '%USERPROFILE%\\.hermes\\cron\\'],
      projectResourcePaths: ['<project>\\AGENTS.md', '<project>\\SOUL.md', '<project>\\.cursorrules']
    }
  }
};

function buildProfile(agentId: BuiltInAgentId, platform: AgentProfilePlatform, definition: AgentDefinition): AgentPathProfile {
  const seed = definition[platform];
  const fallbackRoot = platform === 'windows'
    ? `%USERPROFILE%\\.enterprise-agent\\local\\${agentId}\\`
    : `\${HOME}/.enterprise-agent/local/${agentId}/`;
  const resourcePaths = createResourcePaths(seed, fallbackRoot, platform, definition.fallbackKinds ?? fallbackKinds);
  return {
    platform,
    detectionRoots: [...seed.detectionRoots],
    globalResourcePaths: [...seed.globalResourcePaths],
    projectResourcePaths: [...seed.projectResourcePaths],
    fallbackRoot,
    sourceLevel: definition.sourceLevels[0],
    sourceLevels: [...definition.sourceLevels],
    envOverrides: definition.envOverrides,
    capabilityStatus: capabilityStatusFor(resourcePaths),
    resourcePaths,
    notes: seed.notes
  };
}

function createResourcePaths(seed: ProfileSeed, fallbackRoot: string, platform: AgentProfilePlatform, eaKinds: AgentResourceKind[]): Partial<Record<AgentResourceKind, string[]>> {
  const joiner = platform === 'windows' ? '\\' : '/';
  const fallback = (kind: AgentResourceKind) => `${fallbackRoot}${kind}${joiner}`;
  return Object.fromEntries(ALL_RESOURCE_KINDS.map((kind) => {
    const nativePaths = resourcePathsFromSeed(kind, seed);
    const paths = nativePaths.length > 0 ? nativePaths : eaKinds.includes(kind) ? [fallback(kind)] : [];
    return [kind, paths];
  })) as Partial<Record<AgentResourceKind, string[]>>;
}

function resourcePathsFromSeed(kind: AgentResourceKind, seed: ProfileSeed): string[] {
  const all = [...seed.globalResourcePaths, ...seed.projectResourcePaths];
  switch (kind) {
    case 'settings':
      return all.filter((item) => /settings|config|opencode\.json|mcp\.json/i.test(item));
    case 'rules':
      return all.filter((item) => /AGENTS|CLAUDE|GEMINI|SOUL|rules|instructions|cursorrules|workflows|worktreeinclude/i.test(item));
    case 'memory':
      return all.filter((item) => /memory|memories/i.test(item));
    case 'subagents':
      return all.filter((item) => /agents/i.test(item));
    case 'ignore-files':
      return all.filter((item) => /ignore|worktreeinclude/i.test(item));
    case 'skills':
      return all.filter((item) => /skills/i.test(item));
    case 'mcp':
      return all.filter((item) => /mcp/i.test(item));
    case 'plugins':
      return all.filter((item) => /plugins/i.test(item));
    case 'hooks':
      return all.filter((item) => /settings|config/i.test(item));
    case 'cli':
      return all.filter((item) => /commands|cron|config|settings|opencode\.json/i.test(item));
    case 'files':
      return all;
    default:
      return [];
  }
}

function capabilityStatusFor(resourcePaths: Partial<Record<AgentResourceKind, string[]>>): Partial<Record<AgentResourceKind, AgentCapabilityStatus>> {
  return Object.fromEntries(ALL_RESOURCE_KINDS.map((kind) => {
    const paths = resourcePaths[kind] ?? [];
    return [kind, paths.length > 0 ? 'SUPPORTED' : 'USER_CONFIG_REQUIRED'];
  })) as Partial<Record<AgentResourceKind, AgentCapabilityStatus>>;
}

function customProfileTemplate(platform: AgentProfilePlatform): AgentPathProfile {
  return {
    platform,
    detectionRoots: [],
    globalResourcePaths: [],
    projectResourcePaths: [],
    fallbackRoot: platform === 'windows'
      ? '%USERPROFILE%\\.enterprise-agent\\local\\custom-directory\\'
      : '${HOME}/.enterprise-agent/local/custom-directory/',
    sourceLevel: 'USER_CONFIG_REQUIRED',
    sourceLevels: ['USER_CONFIG_REQUIRED', 'EA_MANAGED'],
    capabilityStatus: Object.fromEntries(ALL_RESOURCE_KINDS.map((kind) => [kind, 'USER_CONFIG_REQUIRED'])) as Partial<Record<AgentResourceKind, AgentCapabilityStatus>>,
    resourcePaths: {},
    notes: ['Custom Agent Profile must be configured before scanning.']
  };
}

function customPathProfileForPlatform(profile: CustomAgentProfile, platform: AgentProfilePlatform): AgentPathProfile {
  if (profile.pathProfile.platform === platform) {
    return {
      ...profile.pathProfile,
      detectionRoots: [...profile.pathProfile.detectionRoots],
      globalResourcePaths: [...profile.pathProfile.globalResourcePaths],
      projectResourcePaths: [...profile.pathProfile.projectResourcePaths],
      sourceLevel: profile.pathProfile.sourceLevel ?? 'USER_CONFIG_REQUIRED',
      sourceLevels: profile.pathProfile.sourceLevels ?? ['USER_CONFIG_REQUIRED', 'EA_MANAGED'],
      capabilityStatus: profile.pathProfile.capabilityStatus ?? capabilityStatusFor(profile.pathProfile.resourcePaths ?? {}),
      resourcePaths: cloneResourcePaths(profile.pathProfile.resourcePaths ?? {})
    };
  }
  const template = customProfileTemplate(platform);
  return {
    ...template,
    notes: ['Custom Agent Profile has not configured path rules for this platform.']
  };
}

function replacePathTokens(value: string, replacements: Record<string, string>, platform: AgentProfilePlatform): string {
  let output = value;
  for (const [token, replacement] of Object.entries(replacements)) output = output.split(token).join(replacement);
  if (platform === 'windows') return output.replace(/\//g, '\\');
  return output.replace(/\\/g, '/');
}

function replaceAgentRootPrefix(value: string, defaultRoots: string[], overrideRoot: string | undefined, platform: AgentProfilePlatform): string {
  if (!overrideRoot) return value;
  const normalizedValue = normalizeSeparators(value, platform);
  const configuredRoot = normalizeSeparators(overrideRoot, platform).replace(/[\\/]$/, '');
  const separator = platform === 'windows' ? '\\' : '/';
  for (const root of defaultRoots) {
    const normalizedRoot = normalizeSeparators(root, platform).replace(/[\\/]$/, '');
    if (!normalizedRoot || normalizedRoot.includes('<project>')) continue;
    if (normalizedValue === normalizedRoot) return configuredRoot;
    if (normalizedValue.startsWith(`${normalizedRoot}${separator}`)) {
      return `${configuredRoot}${normalizedValue.slice(normalizedRoot.length)}`;
    }
  }
  return value;
}

function normalizeSeparators(value: string, platform: AgentProfilePlatform): string {
  return platform === 'windows' ? value.replace(/\//g, '\\') : value.replace(/\\/g, '/');
}

function cloneResourcePaths(resourcePaths: Partial<Record<AgentResourceKind, string[]>>): Partial<Record<AgentResourceKind, string[]>> {
  return Object.fromEntries(Object.entries(resourcePaths).map(([key, values]) => [key, [...(values ?? [])]])) as Partial<Record<AgentResourceKind, string[]>>;
}

function firstDefined(values?: Array<string | undefined>): string | undefined {
  return values?.find((value) => Boolean(value?.trim()));
}

function inferAgentIdFromFallback(fallbackRoot?: string): string | undefined {
  if (!fallbackRoot) return undefined;
  const normalized = fallbackRoot.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').pop();
}

function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
