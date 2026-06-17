import {
  AuthStatuses,
  AuditStatuses,
  DriftStatuses,
  LocalResourceTypes,
  ManagedModes,
  PathStatuses,
  type AuditStatus,
  type AuthStatus,
  type AuthorizationRequirement,
  type DriftStatus,
  type KitResourceKind,
  type LocalResource,
  type LocalResourceType,
  type ManagedMode,
  type PathStatus,
  type ResourceBinding
} from './local-resources';

export type Phase3PageSurface = 'extensions' | 'projects' | 'toolkits';
export type OperationPolicyStatus = 'allowed' | 'blocked' | 'disabled' | 'read_only';
export type Phase3OperationResultStatus =
  | 'success'
  | 'failure'
  | 'partial_success'
  | 'rolled_back'
  | 'rollback_failed'
  | 'blocked'
  | 'disabled'
  | 'dry_run';
export type ResourceChangeStatus = Phase3OperationResultStatus | 'skipped' | 'pending';
export type BackupRequirement = 'required' | 'not_required' | 'already_protected';

export interface Phase3ResourceContext {
  resourceId?: string;
  bindingId?: string;
  sourceId?: string;
  name?: string;
  resourceType: LocalResourceType | KitResourceKind;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  targetPath?: string;
  authStatus?: AuthStatus;
  auditStatus?: AuditStatus;
  driftStatus?: DriftStatus;
  pathStatus?: PathStatus;
  lastKnownHash?: string;
  currentHash?: string;
  expectedHash?: string;
  managedMode?: ManagedMode;
  serverManaged?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Phase3AffectedResource {
  resourceId?: string;
  bindingId?: string;
  sourceId?: string;
  name?: string;
  resourceType: LocalResourceType | KitResourceKind;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  targetPath?: string;
}

export interface OperationPolicyCheck {
  id: string;
  status: 'pass' | 'warn' | 'block' | 'not_applicable';
  message: string;
  errorCode?: string;
  suggestion?: string;
  resourceId?: string;
  bindingId?: string;
}

export interface OperationPolicyDecision {
  operation: string;
  surface: Phase3PageSurface;
  status: OperationPolicyStatus;
  label: string;
  reason?: string;
  suggestion?: string;
  requiredAuthorizations: AuthorizationRequirement[];
  requiresHash: boolean;
  backupRequirement: BackupRequirement;
  rollbackSupported: boolean;
  offlineAvailable: boolean;
  staticOnly: boolean;
  checks: OperationPolicyCheck[];
  affectedResources: Phase3AffectedResource[];
  affectedAgents: string[];
  affectedProjects: string[];
  affectedKits: string[];
  metadata: Record<string, unknown>;
}

export interface ResourceChangeResult {
  resourceRefId?: string;
  resourceId?: string;
  bindingId?: string;
  resourceType?: LocalResourceType | KitResourceKind;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  targetPath?: string;
  status: ResourceChangeStatus;
  message: string;
  errorCode?: string;
  failureReason?: string;
  suggestion?: string;
  rollbackStatus?: 'not_needed' | 'success' | 'failed';
  executionId?: string;
  eventId?: string;
  metadata?: Record<string, unknown>;
}

export interface Phase3OperationResult {
  operation: string;
  surface: Phase3PageSurface;
  status: Phase3OperationResultStatus;
  policy: OperationPolicyDecision;
  planId?: string;
  executionId?: string;
  backupSnapshotId?: string;
  resourceResults: ResourceChangeResult[];
  eventIds: string[];
  message: string;
  failureReason?: string;
  suggestion?: string;
  metadata: Record<string, unknown>;
}

export interface CliVersionSummary {
  label: string;
  version?: string;
  source: 'manifest' | 'metadata' | 'file-attributes' | 'unknown';
  reason?: string;
}

export interface Phase3OperationPolicyInput {
  surface: Phase3PageSurface;
  operation: string;
  resources?: Phase3ResourceContext[];
  offline?: boolean;
  metadata?: Record<string, unknown>;
}

interface OperationDefinition {
  surface: Phase3PageSurface;
  label: string;
  mutates: boolean;
  staticOnly?: boolean;
  readOnly?: boolean;
  requiresAuthorization?: boolean;
  requiresHash?: boolean;
  requiresBackup?: boolean;
  rollbackSupported?: boolean;
  offlineAvailable?: boolean;
  allowedDuringAuthShrink?: boolean;
}

export interface Phase4OperationCoverageItem {
  localOperation: string;
  operation: string;
  surface: Phase3PageSurface;
  resourceType: LocalResourceType;
  offlineAvailable: boolean;
  requiresAuthorization: boolean;
  requiresHash: boolean;
  backupRequirement: BackupRequirement;
  rollbackSupported: boolean;
  staticOnly: boolean;
}

const EXTENSION_CLEANUP_OPS = [
  'skill.disable',
  'skill.uninstall',
  'mcp.disable',
  'mcp.uninstall',
  'mcp.remove-managed-config',
  'mcp.cleanup-secret-refs',
  'plugin.disable',
  'plugin.uninstall',
  'plugin.manual-record-cleanup',
  'plugin.mark-uninstalled'
] as const;

const STATIC_OPS = [
  'skill.static-audit',
  'skill.view-events',
  'mcp.static-config-check',
  'mcp.view-events',
  'plugin.static-audit',
  'plugin.view-events',
  'hook.path-check',
  'hook.static-audit',
  'hook.view-events',
  'cli.path-check',
  'cli.version-metadata-read',
  'cli.static-audit',
  'cli.view-events',
  'project.path-check',
  'project.static-audit',
  'kit.view-drift',
  'kit.static-audit',
  'kit.view-events'
] as const;

export const PHASE3_ACTION_REGISTRY: Record<string, OperationDefinition> = {
  'skill.install': write('extensions', '安装 Skill'),
  'skill.enable': write('extensions', '启用 Skill', { offlineAvailable: true }),
  'skill.update': write('extensions', '更新 Skill'),
  ...cleanupDefinitions('extensions', EXTENSION_CLEANUP_OPS),
  'mcp.configure': write('extensions', '写入 MCP 托管配置'),
  'mcp.update': write('extensions', '更新 MCP 托管配置'),
  'mcp.config-write': write('extensions', '写入 MCP 托管配置'),
  'mcp.config-update': write('extensions', '更新 MCP 托管配置'),
  'mcp.config-disable': write('extensions', '停用 MCP 托管配置', { requiresAuthorization: false, requiresHash: false, allowedDuringAuthShrink: true, offlineAvailable: true }),
  'mcp.config-uninstall': write('extensions', '卸载 MCP 托管配置', { requiresAuthorization: false, requiresHash: false, allowedDuringAuthShrink: true, offlineAvailable: true }),
  'mcp.copy-config': write('extensions', '复制 MCP 配置'),
  'mcp.connection-test': { ...write('extensions', 'MCP 连接检测'), requiresBackup: false, rollbackSupported: false },
  'plugin.install': write('extensions', '安装 Plugin'),
  'plugin.download': write('extensions', '下载 Plugin'),
  'plugin.enable': write('extensions', '启用 Plugin', { offlineAvailable: true }),
  'plugin.update': write('extensions', '更新 Plugin'),
  'plugin.repair': write('extensions', '修复 Plugin'),
  'settings.update': localConfigWrite('extensions', '更新 Settings'),
  'settings.restore': localConfigWrite('extensions', '恢复 Settings'),
  'rules.enable': localConfigWrite('extensions', '启用 Rule'),
  'rules.disable': localConfigWrite('extensions', '停用 Rule'),
  'rules.update': localConfigWrite('extensions', '更新 Rules'),
  'memory.update': localConfigWrite('extensions', '更新 Memory'),
  'memory.restore': localConfigWrite('extensions', '恢复 Memory'),
  'subagents.enable': localConfigWrite('extensions', '启用 Subagent'),
  'subagents.disable': localConfigWrite('extensions', '停用 Subagent'),
  'subagents.update': localConfigWrite('extensions', '更新 Subagents'),
  'ignore.update': localConfigWrite('extensions', '更新 Ignore Files'),
  'custom-agent-profile.create': localConfigWrite('extensions', '创建 Custom Agent Profile'),
  'custom-agent-profile.update': localConfigWrite('extensions', '更新 Custom Agent Profile'),
  'hook.register': write('extensions', '登记 Hook 配置', { staticOnly: true, requiresAuthorization: false, offlineAvailable: true }),
  'hook.enable': write('extensions', '启用 Hook 配置', { staticOnly: true, requiresAuthorization: false, offlineAvailable: true }),
  'hook.disable': write('extensions', '停用 Hook 配置', { staticOnly: true, requiresAuthorization: false, allowedDuringAuthShrink: true, offlineAvailable: true }),
  'hook.update': write('extensions', '更新 Hook 配置', { staticOnly: true, requiresAuthorization: false, offlineAvailable: true }),
  'cli.register': write('extensions', '登记 CLI 配置', { staticOnly: true, requiresAuthorization: false, offlineAvailable: true }),
  'cli.enable': write('extensions', '启用 CLI 配置', { staticOnly: true, requiresAuthorization: false, offlineAvailable: true }),
  'cli.disable': write('extensions', '停用 CLI 配置', { staticOnly: true, requiresAuthorization: false, allowedDuringAuthShrink: true, offlineAvailable: true }),
  'cli.update': write('extensions', '更新 CLI 配置', { staticOnly: true, requiresAuthorization: false, offlineAvailable: true }),
  ...staticDefinitions('extensions', STATIC_OPS.filter((operation) => operation.includes('.') && !operation.startsWith('project.') && !operation.startsWith('kit.'))),

  'project.register': metadataWrite('projects', '登记项目'),
  'project.update-path': metadataWrite('projects', '更新项目路径'),
  'project.rescan': metadataWrite('projects', '重新扫描项目', { offlineAvailable: true }),
  'project.enable-agent': metadataWrite('projects', '启用项目智能体'),
  'project.enable-local-resource': metadataWrite('projects', '启用项目本地资源'),
  'project.apply-kit': write('projects', '应用 Kit 到项目'),
  'project.remove-record': metadataWrite('projects', '删除项目管理记录', { allowedDuringAuthShrink: true }),
  ...staticDefinitions('projects', STATIC_OPS.filter((operation) => operation.startsWith('project.'))),

  'kit.create': metadataWrite('toolkits', '新建 Kit', { offlineAvailable: true }),
  'kit.edit': metadataWrite('toolkits', '编辑 Kit', { offlineAvailable: true }),
  'kit.import': metadataWrite('toolkits', '导入 Kit', { offlineAvailable: true }),
  'kit.export': write('toolkits', '导出 Kit', { requiresAuthorization: false, offlineAvailable: true }),
  'kit.export-data': metadataWrite('toolkits', '导出 Kit manifest 数据', { offlineAvailable: true }),
  'kit.generate-from-agent': metadataWrite('toolkits', '从智能体生成 Kit', { offlineAvailable: true }),
  'kit.generate-from-project': metadataWrite('toolkits', '从项目生成 Kit', { offlineAvailable: true }),
  'kit.apply': write('toolkits', '应用 Kit', { offlineAvailable: true }),
  'kit.remove': write('toolkits', '移除 Kit 应用', { requiresAuthorization: false, requiresHash: false, allowedDuringAuthShrink: true, offlineAvailable: true }),
  'kit.remove-application': write('toolkits', '移除 Kit 应用', { requiresAuthorization: false, requiresHash: false, allowedDuringAuthShrink: true, offlineAvailable: true }),
  'kit.drift-check': metadataWrite('toolkits', '检查 Kit 漂移', { offlineAvailable: true }),
  'kit.static-audit-run': metadataWrite('toolkits', '运行 Kit 静态审计', { offlineAvailable: true }),
  'kit.check-update': write('toolkits', '检查 Kit 更新', { requiresBackup: false, rollbackSupported: false }),
  ...staticDefinitions('toolkits', STATIC_OPS.filter((operation) => operation.startsWith('kit.')))
};

export const PHASE4_LOCAL_OPERATION_COVERAGE: readonly Phase4OperationCoverageItem[] = [
  coverage('SETTINGS_UPDATE', 'settings.update', 'extensions', LocalResourceTypes.AGENT_CONFIG, true, false, true, 'required', true, false),
  coverage('SETTINGS_RESTORE', 'settings.restore', 'extensions', LocalResourceTypes.AGENT_CONFIG, true, false, true, 'required', true, false),
  coverage('RULE_ENABLE', 'rules.enable', 'extensions', LocalResourceTypes.RULE, true, false, true, 'required', true, false),
  coverage('RULE_DISABLE', 'rules.disable', 'extensions', LocalResourceTypes.RULE, true, false, true, 'required', true, false),
  coverage('RULE_UPDATE', 'rules.update', 'extensions', LocalResourceTypes.RULE, true, false, true, 'required', true, false),
  coverage('MEMORY_UPDATE', 'memory.update', 'extensions', LocalResourceTypes.MEMORY, true, false, true, 'required', true, false),
  coverage('MEMORY_RESTORE', 'memory.restore', 'extensions', LocalResourceTypes.MEMORY, true, false, true, 'required', true, false),
  coverage('SUBAGENT_ENABLE', 'subagents.enable', 'extensions', LocalResourceTypes.SUBAGENT, true, false, true, 'required', true, false),
  coverage('SUBAGENT_DISABLE', 'subagents.disable', 'extensions', LocalResourceTypes.SUBAGENT, true, false, true, 'required', true, false),
  coverage('SUBAGENT_UPDATE', 'subagents.update', 'extensions', LocalResourceTypes.SUBAGENT, true, false, true, 'required', true, false),
  coverage('IGNORE_UPDATE', 'ignore.update', 'extensions', LocalResourceTypes.IGNORE_FILE, true, false, true, 'required', true, false),
  coverage('SKILL_INSTALL', 'skill.install', 'extensions', LocalResourceTypes.SKILL, false, true, true, 'required', true, false),
  coverage('SKILL_ENABLE', 'skill.enable', 'extensions', LocalResourceTypes.SKILL, true, true, true, 'required', true, false),
  coverage('SKILL_DISABLE', 'skill.disable', 'extensions', LocalResourceTypes.SKILL, true, false, false, 'required', true, false),
  coverage('SKILL_UPDATE', 'skill.update', 'extensions', LocalResourceTypes.SKILL, false, true, true, 'required', true, false),
  coverage('SKILL_UNINSTALL', 'skill.uninstall', 'extensions', LocalResourceTypes.SKILL, true, false, false, 'required', true, false),
  coverage('MCP_CONFIG_WRITE', 'mcp.config-write', 'extensions', LocalResourceTypes.MCP_SERVER, false, true, true, 'required', true, false),
  coverage('MCP_CONFIG_UPDATE', 'mcp.config-update', 'extensions', LocalResourceTypes.MCP_SERVER, false, true, true, 'required', true, false),
  coverage('MCP_CONFIG_DISABLE', 'mcp.config-disable', 'extensions', LocalResourceTypes.MCP_SERVER, true, false, false, 'required', true, false),
  coverage('MCP_CONFIG_UNINSTALL', 'mcp.config-uninstall', 'extensions', LocalResourceTypes.MCP_SERVER, true, false, false, 'required', true, false),
  coverage('PLUGIN_INSTALL', 'plugin.install', 'extensions', LocalResourceTypes.PLUGIN, false, true, true, 'required', true, false),
  coverage('PLUGIN_ENABLE', 'plugin.enable', 'extensions', LocalResourceTypes.PLUGIN, true, true, true, 'required', true, false),
  coverage('PLUGIN_DISABLE', 'plugin.disable', 'extensions', LocalResourceTypes.PLUGIN, true, false, false, 'required', true, false),
  coverage('PLUGIN_UPDATE', 'plugin.update', 'extensions', LocalResourceTypes.PLUGIN, false, true, true, 'required', true, false),
  coverage('PLUGIN_UNINSTALL', 'plugin.uninstall', 'extensions', LocalResourceTypes.PLUGIN, true, false, false, 'required', true, false),
  coverage('HOOK_REGISTER', 'hook.register', 'extensions', LocalResourceTypes.HOOK, true, false, true, 'required', true, true),
  coverage('HOOK_ENABLE', 'hook.enable', 'extensions', LocalResourceTypes.HOOK, true, false, true, 'required', true, true),
  coverage('HOOK_DISABLE', 'hook.disable', 'extensions', LocalResourceTypes.HOOK, true, false, true, 'required', true, true),
  coverage('HOOK_UPDATE', 'hook.update', 'extensions', LocalResourceTypes.HOOK, true, false, true, 'required', true, true),
  coverage('CLI_REGISTER', 'cli.register', 'extensions', LocalResourceTypes.CLI_COMMAND, true, false, true, 'required', true, true),
  coverage('CLI_ENABLE', 'cli.enable', 'extensions', LocalResourceTypes.CLI_COMMAND, true, false, true, 'required', true, true),
  coverage('CLI_DISABLE', 'cli.disable', 'extensions', LocalResourceTypes.CLI_COMMAND, true, false, true, 'required', true, true),
  coverage('CLI_UPDATE', 'cli.update', 'extensions', LocalResourceTypes.CLI_COMMAND, true, false, true, 'required', true, true),
  coverage('KIT_APPLY', 'kit.apply', 'toolkits', LocalResourceTypes.KIT, true, true, true, 'required', true, false),
  coverage('KIT_REMOVE', 'kit.remove', 'toolkits', LocalResourceTypes.KIT, true, false, false, 'required', true, false),
  coverage('PROJECT_REGISTER', 'project.register', 'projects', LocalResourceTypes.PROJECT, true, false, false, 'not_required', false, false),
  coverage('PROJECT_UPDATE_PATH', 'project.update-path', 'projects', LocalResourceTypes.PROJECT, true, false, false, 'not_required', false, false),
  coverage('PROJECT_REMOVE_RECORD', 'project.remove-record', 'projects', LocalResourceTypes.PROJECT, true, false, false, 'not_required', false, false),
  coverage('CUSTOM_AGENT_PROFILE_CREATE', 'custom-agent-profile.create', 'extensions', LocalResourceTypes.AGENT, true, false, true, 'required', true, false),
  coverage('CUSTOM_AGENT_PROFILE_UPDATE', 'custom-agent-profile.update', 'extensions', LocalResourceTypes.AGENT, true, false, true, 'required', true, false)
];

export function createPhase3OperationPolicyDecision(input: Phase3OperationPolicyInput): OperationPolicyDecision {
  const definition = PHASE3_ACTION_REGISTRY[input.operation] ?? inferDefinition(input);
  const resources = input.resources ?? [];
  const checks: OperationPolicyCheck[] = [];

  if (input.offline && !definition.offlineAvailable) {
    checks.push({
      id: 'offline-boundary',
      status: 'block',
      message: '该操作需要联网授权、下载凭证或服务端状态确认。',
      errorCode: 'offline_server_authority_required',
      suggestion: '联网后重试，或改用本地静态审计、事件查看、清理类操作。'
    });
  }

  for (const resource of resources) {
    const authBlocked = isAuthorizationShrink(resource);
    const securityBlocked = resource.authStatus === AuthStatuses.SECURITY_DELISTED || resource.auditStatus === AuditStatuses.SECURITY_RISK;
    if ((authBlocked || securityBlocked) && shouldBlockForAuth(definition, resource, input.operation)) {
      checks.push({
        id: securityBlocked ? 'security-delisted' : 'authorization-shrink',
        status: 'block',
        message: securityBlocked ? '资源已安全下架，禁止新增写入或接入。' : '资源处于授权收缩状态，禁止新增安装、启用、下载、复制配置、更新或 Kit 应用。',
        errorCode: securityBlocked ? 'security_delisted' : 'authorization_shrink',
        suggestion: '允许停用、卸载、解除托管配置、清理敏感变量引用、清理本地记录、查看事件或运行本地静态审计。',
        resourceId: resource.resourceId,
        bindingId: resource.bindingId
      });
    }

    if (!authBlocked && !securityBlocked && shouldRequireVerifiedAuthorization(definition, resource, input.operation) && !hasVerifiedAuthorization(resource.authStatus)) {
      checks.push({
        id: 'authorization-not-verified',
        status: 'block',
        message: '资源授权状态未验证，禁止新增写入、接入或 Kit 应用。',
        errorCode: resource.authStatus === AuthStatuses.OFFLINE_UNKNOWN ? 'authorization_offline_unknown' : 'authorization_not_verified',
        suggestion: '先刷新授权缓存或改用查看事件、静态审计、停用、卸载、清理本地记录等不新增写入的操作。',
        resourceId: resource.resourceId,
        bindingId: resource.bindingId
      });
    }

    const driftBlocked = hasBlockingHashOrDrift(resource);
    if (definition.requiresHash && driftBlocked && !definition.allowedDuringAuthShrink) {
      checks.push({
        id: 'hash-or-drift',
        status: 'block',
        message: '资源 Hash 或托管文件状态异常，禁止覆盖写入。',
        errorCode: 'hash_mismatch',
        suggestion: '先查看漂移详情，确认或清理本地记录后再执行写入。',
        resourceId: resource.resourceId,
        bindingId: resource.bindingId
      });
    } else if (driftBlocked) {
      checks.push({
        id: 'hash-or-drift-warning',
        status: 'warn',
        message: '资源存在 Hash 或漂移异常，清理类操作仍可继续但必须保留事件记录。',
        resourceId: resource.resourceId,
        bindingId: resource.bindingId
      });
    }

    if (definition.mutates && !definition.allowedDuringAuthShrink && isBlockingPathStatus(resource.pathStatus)) {
      checks.push({
        id: 'path-status',
        status: 'block',
        message: '目标路径异常，禁止直接写入。',
        errorCode: 'target_path_not_found',
        suggestion: '先修复路径、改用清理操作，或在项目页查看关联资源清理指引。',
        resourceId: resource.resourceId,
        bindingId: resource.bindingId
      });
    }
  }

  const mcpProcessCheck = input.operation === 'mcp.connection-test' ? mcpConnectionPolicyCheck(resources, input.metadata) : undefined;
  if (mcpProcessCheck) checks.push(mcpProcessCheck);

  if (definition.staticOnly) {
    checks.push({
      id: 'static-only',
      status: 'pass',
      message: '该操作只允许配置管理、路径检查、权限摘要、静态审计或配置事件展示，不执行本地命令。'
    });
  }

  const blocking = checks.filter((check) => check.status === 'block');
  const disabled = checks.find((check) => check.id === 'mcp-process-connection-test' && check.status === 'block');
  const status: OperationPolicyStatus = disabled
    ? 'disabled'
    : blocking.length > 0
      ? 'blocked'
      : definition.readOnly
        ? 'read_only'
        : 'allowed';
  const reason = blocking.map((check) => check.message).join(' ');
  const suggestion = blocking.map((check) => check.suggestion).filter(Boolean).join(' ') || undefined;

  return {
    operation: input.operation,
    surface: input.surface,
    status,
    label: definition.label,
    reason: reason || undefined,
    suggestion,
    requiredAuthorizations: requiredAuthorizations(resources, definition, input.operation),
    requiresHash: Boolean(definition.requiresHash),
    backupRequirement: definition.requiresBackup ? 'required' : 'not_required',
    rollbackSupported: Boolean(definition.rollbackSupported),
    offlineAvailable: Boolean(definition.offlineAvailable),
    staticOnly: Boolean(definition.staticOnly),
    checks,
    affectedResources: resources.map(toAffectedResource),
    affectedAgents: unique(resources.map((resource) => resource.agentId)),
    affectedProjects: unique(resources.map((resource) => resource.projectId)),
    affectedKits: unique(resources.map((resource) => resource.kitId)),
    metadata: { ...(input.metadata ?? {}), mutates: definition.mutates }
  };
}

export function isPhase3OperationPermitted(decision: OperationPolicyDecision): boolean {
  return decision.status === 'allowed' || decision.status === 'read_only';
}

export function toPhase3ResourceContext(input: {
  resource: LocalResource;
  binding?: ResourceBinding;
  expectedHash?: string;
  metadata?: Record<string, unknown>;
}): Phase3ResourceContext {
  return {
    resourceId: input.resource.id,
    bindingId: input.binding?.id,
    sourceId: input.resource.sourceId,
    name: input.resource.displayName || input.resource.name,
    resourceType: input.resource.type,
    agentId: input.binding?.agentId,
    projectId: input.binding?.projectId,
    kitId: input.binding?.kitId,
    targetPath: input.binding?.targetPath ?? input.resource.sourcePath,
    authStatus: input.binding?.authStatus,
    auditStatus: input.binding?.auditStatus ?? input.resource.auditSummary.status,
    driftStatus: input.binding?.driftStatus,
    pathStatus: input.binding?.pathStatus,
    lastKnownHash: input.binding?.lastKnownHash ?? input.resource.sha256 ?? input.resource.packageHash,
    currentHash: input.binding?.currentHash,
    expectedHash: input.expectedHash ?? input.resource.sha256 ?? input.resource.packageHash,
    managedMode: input.binding?.managedMode,
    serverManaged: input.resource.centralStoreManaged || input.binding?.managedMode === ManagedModes.SERVER_MANAGED,
    metadata: { ...input.resource.metadata, ...(input.binding?.metadata ?? {}), ...(input.metadata ?? {}) }
  };
}

export function summarizeCliVersion(resource?: Pick<Phase3ResourceContext, 'metadata' | 'name'> & { version?: string }): CliVersionSummary {
  const metadata = resource?.metadata ?? {};
  const manifest = metadata.manifest && typeof metadata.manifest === 'object' && !Array.isArray(metadata.manifest)
    ? metadata.manifest as Record<string, unknown>
    : undefined;
  const manifestVersion = stringValue(metadata.manifestVersion ?? manifest?.version);
  if (manifestVersion) return { label: manifestVersion, version: manifestVersion, source: 'manifest' };
  const metadataVersion = stringValue(metadata.version ?? metadata.installVersion ?? resource?.version);
  if (metadataVersion) return { label: metadataVersion, version: metadataVersion, source: 'metadata' };
  const fileVersion = stringValue(metadata.fileVersion ?? metadata.fileAttributesVersion);
  if (fileVersion) return { label: fileVersion, version: fileVersion, source: 'file-attributes' };
  return {
    label: '版本未知',
    source: 'unknown',
    reason: 'manifest、配置、安装元数据和文件属性中均没有版本字段；阶段三不会执行 CLI 或调用 --version。'
  };
}

export function aggregateResourceChangeStatus(results: ResourceChangeResult[], fallback: Phase3OperationResultStatus = 'success'): Phase3OperationResultStatus {
  if (results.length === 0) return fallback === 'success' ? 'failure' : fallback;
  if (results.some((result) => result.status === 'rollback_failed')) return 'rollback_failed';
  const successLike = results.filter((result) => result.status === 'success' || result.status === 'skipped' || result.status === 'dry_run');
  const failureLike = results.filter((result) => ['failure', 'blocked', 'disabled', 'rolled_back'].includes(result.status));
  if (failureLike.length > 0 && successLike.length > 0) return 'partial_success';
  if (results.every((result) => result.status === 'blocked')) return 'blocked';
  if (results.every((result) => result.status === 'disabled')) return 'disabled';
  if (results.every((result) => result.status === 'rolled_back')) return 'rolled_back';
  if (failureLike.length > 0) return 'failure';
  if (results.every((result) => result.status === 'dry_run')) return 'dry_run';
  return 'success';
}

function write(surface: Phase3PageSurface, label: string, overrides: Partial<OperationDefinition> = {}): OperationDefinition {
  return {
    surface,
    label,
    mutates: true,
    requiresAuthorization: true,
    requiresHash: true,
    requiresBackup: true,
    rollbackSupported: true,
    offlineAvailable: false,
    allowedDuringAuthShrink: false,
    ...overrides
  };
}

function localConfigWrite(surface: Phase3PageSurface, label: string, overrides: Partial<OperationDefinition> = {}): OperationDefinition {
  return write(surface, label, {
    requiresAuthorization: false,
    offlineAvailable: true,
    ...overrides
  });
}

function metadataWrite(surface: Phase3PageSurface, label: string, overrides: Partial<OperationDefinition> = {}): OperationDefinition {
  return write(surface, label, {
    requiresAuthorization: false,
    requiresHash: false,
    requiresBackup: false,
    rollbackSupported: false,
    offlineAvailable: true,
    ...overrides
  });
}

function coverage(
  localOperation: string,
  operation: string,
  surface: Phase3PageSurface,
  resourceType: LocalResourceType,
  offlineAvailable: boolean,
  requiresAuthorization: boolean,
  requiresHash: boolean,
  backupRequirement: BackupRequirement,
  rollbackSupported: boolean,
  staticOnly: boolean
): Phase4OperationCoverageItem {
  return {
    localOperation,
    operation,
    surface,
    resourceType,
    offlineAvailable,
    requiresAuthorization,
    requiresHash,
    backupRequirement,
    rollbackSupported,
    staticOnly
  };
}

function cleanupDefinitions(surface: Phase3PageSurface, operations: readonly string[]): Record<string, OperationDefinition> {
  return Object.fromEntries(operations.map((operation) => [operation, write(surface, cleanupLabel(operation), {
    requiresAuthorization: false,
    requiresHash: false,
    allowedDuringAuthShrink: true,
    offlineAvailable: true
  })]));
}

function staticDefinitions(surface: Phase3PageSurface, operations: readonly string[]): Record<string, OperationDefinition> {
  return Object.fromEntries(operations.map((operation) => [operation, {
    surface,
    label: staticLabel(operation),
    mutates: false,
    staticOnly: true,
    readOnly: true,
    requiresAuthorization: false,
    requiresHash: false,
    requiresBackup: false,
    rollbackSupported: false,
    offlineAvailable: true,
    allowedDuringAuthShrink: true
  } satisfies OperationDefinition]));
}

function inferDefinition(input: Phase3OperationPolicyInput): OperationDefinition {
  return {
    surface: input.surface,
    label: input.operation,
    mutates: true,
    requiresAuthorization: true,
    requiresHash: true,
    requiresBackup: true,
    rollbackSupported: true,
    offlineAvailable: false,
    allowedDuringAuthShrink: false
  };
}

function cleanupLabel(operation: string): string {
  if (operation.includes('uninstall')) return '卸载或移除托管记录';
  if (operation.includes('disable')) return '停用资源';
  if (operation.includes('secret')) return '清理敏感变量引用';
  if (operation.includes('cleanup')) return '清理本地记录';
  return '清理操作';
}

function staticLabel(operation: string): string {
  if (operation.includes('audit')) return '运行本地静态审计';
  if (operation.includes('event')) return '查看事件';
  if (operation.includes('path-check')) return '路径检查';
  if (operation.includes('version')) return '读取版本元数据';
  if (operation.includes('drift')) return '查看漂移';
  if (operation.includes('check-update')) return '检查更新';
  return '静态检查';
}

function shouldBlockForAuth(definition: OperationDefinition, resource: Phase3ResourceContext, operation: string): boolean {
  if (definition.allowedDuringAuthShrink) return false;
  if (operation === 'kit.apply' || operation === 'project.apply-kit') return true;
  if (isServerManagedExtensionType(resource.resourceType)) return true;
  if (isStaticLocalExecutableType(resource.resourceType)) {
    return Boolean(resource.serverManaged
      || resource.managedMode === ManagedModes.SERVER_MANAGED
      || resource.metadata?.managedByKitId
      || resource.metadata?.managedByPluginId
      || resource.metadata?.serverManaged);
  }
  return Boolean(definition.requiresAuthorization && resource.serverManaged);
}

function shouldRequireVerifiedAuthorization(definition: OperationDefinition, resource: Phase3ResourceContext, operation: string): boolean {
  if (definition.allowedDuringAuthShrink) return false;
  if (operation === 'kit.apply' || operation === 'project.apply-kit') {
    if (isServerManagedExtensionType(resource.resourceType)) return true;
    if (isStaticLocalExecutableType(resource.resourceType)) {
      return Boolean(resource.serverManaged
        || resource.managedMode === ManagedModes.SERVER_MANAGED
        || resource.metadata?.serverManaged);
    }
    return Boolean(resource.serverManaged || resource.managedMode === ManagedModes.SERVER_MANAGED);
  }
  return false;
}

function hasVerifiedAuthorization(status: AuthStatus | undefined): boolean {
  return status === AuthStatuses.AUTH_CACHE_VALID || status === AuthStatuses.AUTHORIZED;
}

function isServerManagedExtensionType(type: LocalResourceType | KitResourceKind): boolean {
  return type === LocalResourceTypes.SKILL || type === LocalResourceTypes.MCP_SERVER || type === LocalResourceTypes.PLUGIN;
}

function isStaticLocalExecutableType(type: LocalResourceType | KitResourceKind): boolean {
  return type === LocalResourceTypes.HOOK || type === LocalResourceTypes.CLI_COMMAND;
}

function isAuthorizationShrink(resource: Phase3ResourceContext): boolean {
  return resource.authStatus === AuthStatuses.AUTH_REVOKED
    || resource.authStatus === AuthStatuses.SECURITY_DELISTED
    || resource.authStatus === AuthStatuses.DELISTED;
}

function hasBlockingHashOrDrift(resource: Phase3ResourceContext): boolean {
  if (resource.expectedHash && resource.currentHash && resource.expectedHash !== resource.currentHash) return true;
  return resource.driftStatus === DriftStatuses.HASH_CHANGED
    || resource.driftStatus === DriftStatuses.DRIFTED
    || resource.driftStatus === DriftStatuses.EXTERNALLY_MODIFIED
    || resource.driftStatus === DriftStatuses.MANAGED_BLOCK_MISSING;
}

function isBlockingPathStatus(statusValue: PathStatus | undefined): boolean {
  return statusValue === PathStatuses.MISSING || statusValue === PathStatuses.NOT_WRITABLE || statusValue === PathStatuses.INVALID || statusValue === PathStatuses.CONFLICT;
}

function mcpConnectionPolicyCheck(resources: Phase3ResourceContext[], metadata: Record<string, unknown> | undefined): OperationPolicyCheck | undefined {
  const transport = stringValue(metadata?.transport ?? metadata?.connectionTestType ?? resources[0]?.metadata?.transport ?? resources[0]?.metadata?.connectionTestType);
  if (!transport) return undefined;
  const normalized = transport.toLowerCase();
  if (['stdio', 'command', 'local_command', 'local-command'].includes(normalized)) {
    return {
      id: 'mcp-process-connection-test',
      status: 'block',
      message: 'MCP stdio/command 类型不能通过启动本地进程做连接检测。',
      errorCode: 'invalid_execution_plan',
      suggestion: '改用静态配置检查；HTTP/SSE 检测必须遵守现有授权和网络边界。'
    };
  }
  return {
    id: 'mcp-network-connection-test',
    status: 'pass',
    message: 'HTTP/SSE 检测可在授权和网络边界内执行。'
  };
}

function requiredAuthorizations(resources: Phase3ResourceContext[], definition: OperationDefinition, operation: string): AuthorizationRequirement[] {
  if (!definition.requiresAuthorization && operation !== 'kit.apply' && operation !== 'project.apply-kit') return [];
  return resources
    .filter((resource) => resource.resourceId || resource.sourceId)
    .map((resource) => ({
      resourceId: resource.resourceId ?? resource.sourceId as string,
      resourceType: resource.resourceType as LocalResourceType,
      reason: `${definition.label} 需要有效授权状态`,
      requiredStatus: AuthStatuses.AUTH_CACHE_VALID
    }));
}

function toAffectedResource(resource: Phase3ResourceContext): Phase3AffectedResource {
  return {
    resourceId: resource.resourceId,
    bindingId: resource.bindingId,
    sourceId: resource.sourceId,
    name: resource.name,
    resourceType: resource.resourceType,
    agentId: resource.agentId,
    projectId: resource.projectId,
    kitId: resource.kitId,
    targetPath: resource.targetPath
  };
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
