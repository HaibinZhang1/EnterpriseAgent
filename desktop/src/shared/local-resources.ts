export const LocalResourceTypes = {
  AGENT: 'AGENT',
  AGENT_CONFIG: 'AGENT_CONFIG',
  RULE: 'RULE',
  MEMORY: 'MEMORY',
  SUBAGENT: 'SUBAGENT',
  IGNORE_FILE: 'IGNORE_FILE',
  SKILL: 'SKILL',
  MCP_SERVER: 'MCP_SERVER',
  PLUGIN: 'PLUGIN',
  HOOK: 'HOOK',
  CLI_COMMAND: 'CLI_COMMAND',
  KIT: 'KIT',
  PROJECT: 'PROJECT',
  AUDIT_FINDING: 'AUDIT_FINDING',
  LOCAL_EVENT: 'LOCAL_EVENT'
} as const;

export type LocalResourceType = typeof LocalResourceTypes[keyof typeof LocalResourceTypes];

export const LocalResourceSourceTypes = {
  CENTRAL_STORE: 'CENTRAL_STORE',
  NATIVE_AGENT_DIRECTORY: 'NATIVE_AGENT_DIRECTORY',
  PROJECT_DIRECTORY: 'PROJECT_DIRECTORY',
  CUSTOM_DIRECTORY: 'CUSTOM_DIRECTORY',
  EA_MANAGED_FALLBACK: 'EA_MANAGED_FALLBACK',
  KIT: 'KIT',
  LOCAL_IMPORT: 'LOCAL_IMPORT',
  MANUAL_RECORD: 'MANUAL_RECORD',
  EXTERNAL_DISCOVERY: 'EXTERNAL_DISCOVERY',
  SERVER_CACHE: 'SERVER_CACHE'
} as const;

export type LocalResourceSourceType = typeof LocalResourceSourceTypes[keyof typeof LocalResourceSourceTypes];

export const ResourceScopeTypes = {
  GLOBAL: 'GLOBAL',
  AGENT_GLOBAL: 'AGENT_GLOBAL',
  PROJECT: 'PROJECT',
  AGENT_PROJECT: 'AGENT_PROJECT',
  CUSTOM_PATH: 'CUSTOM_PATH',
  KIT: 'KIT'
} as const;

export type ResourceScopeType = typeof ResourceScopeTypes[keyof typeof ResourceScopeTypes];

export const ManagedModes = {
  SERVER_MANAGED: 'SERVER_MANAGED',
  LOCAL_MANAGED: 'LOCAL_MANAGED',
  EA_MANAGED: 'EA_MANAGED',
  NATIVE_MANAGED: 'NATIVE_MANAGED',
  MANUAL_RECORD_ONLY: 'MANUAL_RECORD_ONLY',
  EXTERNAL_DISCOVERY_ONLY: 'EXTERNAL_DISCOVERY_ONLY'
} as const;

export type ManagedMode = typeof ManagedModes[keyof typeof ManagedModes];

export const WriteModes = {
  READ_ONLY: 'READ_ONLY',
  NATIVE_FILE_WRITE: 'NATIVE_FILE_WRITE',
  MANAGED_BLOCK_WRITE: 'MANAGED_BLOCK_WRITE',
  CENTRAL_STORE_LINK: 'CENTRAL_STORE_LINK',
  CENTRAL_STORE_COPY: 'CENTRAL_STORE_COPY',
  EA_MANAGED_FILE_WRITE: 'EA_MANAGED_FILE_WRITE',
  MANUAL_RECORD_UPDATE: 'MANUAL_RECORD_UPDATE'
} as const;

export type WriteMode = typeof WriteModes[keyof typeof WriteModes];

export const DetectionStatuses = {
  UNKNOWN: 'UNKNOWN',
  DETECTED: 'DETECTED',
  NOT_DETECTED: 'NOT_DETECTED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  SCAN_FAILED: 'SCAN_FAILED'
} as const;

export type DetectionStatus = typeof DetectionStatuses[keyof typeof DetectionStatuses];

export const LifecycleStatuses = {
  UNKNOWN: 'UNKNOWN',
  INSTALLED: 'INSTALLED',
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
  CONNECTED: 'CONNECTED',
  RECORDED: 'RECORDED',
  UNINSTALLED: 'UNINSTALLED',
  REMOVED: 'REMOVED'
} as const;

export type LifecycleStatus = typeof LifecycleStatuses[keyof typeof LifecycleStatuses];

export const PathStatuses = {
  UNKNOWN: 'UNKNOWN',
  OK: 'OK',
  MISSING: 'MISSING',
  NOT_WRITABLE: 'NOT_WRITABLE',
  INVALID: 'INVALID',
  CONFLICT: 'CONFLICT'
} as const;

export type PathStatus = typeof PathStatuses[keyof typeof PathStatuses];

export const AuthStatuses = {
  UNKNOWN: 'UNKNOWN',
  AUTHORIZED: 'AUTHORIZED',
  AUTH_CACHE_VALID: 'AUTH_CACHE_VALID',
  AUTH_REVOKED: 'AUTH_REVOKED',
  SECURITY_DELISTED: 'SECURITY_DELISTED',
  DELISTED: 'DELISTED',
  OFFLINE_UNKNOWN: 'OFFLINE_UNKNOWN'
} as const;

export type AuthStatus = typeof AuthStatuses[keyof typeof AuthStatuses];

export const AuditStatuses = {
  NOT_AUDITED: 'NOT_AUDITED',
  SAFE: 'SAFE',
  LOW_RISK: 'LOW_RISK',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  HIGH_RISK: 'HIGH_RISK',
  SECURITY_RISK: 'SECURITY_RISK'
} as const;

export type AuditStatus = typeof AuditStatuses[keyof typeof AuditStatuses];

export const DriftStatuses = {
  UNKNOWN: 'UNKNOWN',
  NOT_DRIFTED: 'NOT_DRIFTED',
  DRIFTED: 'DRIFTED',
  EXTERNALLY_MODIFIED: 'EXTERNALLY_MODIFIED',
  MANAGED_BLOCK_MISSING: 'MANAGED_BLOCK_MISSING',
  HASH_CHANGED: 'HASH_CHANGED'
} as const;

export type DriftStatus = typeof DriftStatuses[keyof typeof DriftStatuses];

export const OperationStatuses = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  ROLLED_BACK: 'ROLLED_BACK',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED'
} as const;

export type OperationStatus = typeof OperationStatuses[keyof typeof OperationStatuses];

export const SyncStatuses = {
  LOCAL_ONLY: 'LOCAL_ONLY',
  PENDING_SYNC: 'PENDING_SYNC',
  SYNCED: 'SYNCED',
  SYNC_FAILED: 'SYNC_FAILED',
  SERVER_REJECTED: 'SERVER_REJECTED'
} as const;

export type SyncStatus = typeof SyncStatuses[keyof typeof SyncStatuses];

export const PermissionCategories = {
  FILESYSTEM: 'FILESYSTEM',
  NETWORK: 'NETWORK',
  SHELL: 'SHELL',
  DATABASE: 'DATABASE',
  ENVIRONMENT: 'ENVIRONMENT',
  CONFIG_WRITE: 'CONFIG_WRITE',
  SECRET: 'SECRET',
  PROCESS: 'PROCESS',
  INTEGRITY: 'INTEGRITY',
  CUSTOM_PATH: 'CUSTOM_PATH'
} as const;

export type PermissionCategory = typeof PermissionCategories[keyof typeof PermissionCategories];

export const PermissionItems = {
  FILE_READ: 'FILE_READ',
  FILE_WRITE: 'FILE_WRITE',
  PROJECT_READ: 'PROJECT_READ',
  PROJECT_WRITE: 'PROJECT_WRITE',
  CONFIG_WRITE: 'CONFIG_WRITE',
  NETWORK_DOMAIN: 'NETWORK_DOMAIN',
  SHELL_COMMAND: 'SHELL_COMMAND',
  ENV_READ: 'ENV_READ',
  ENV_WRITE: 'ENV_WRITE',
  SECRET_ACCESS: 'SECRET_ACCESS',
  DATABASE_CONNECTION: 'DATABASE_CONNECTION',
  PROCESS_ACCESS: 'PROCESS_ACCESS',
  CUSTOM_PATH_ACCESS: 'CUSTOM_PATH_ACCESS',
  HASH_INTEGRITY: 'HASH_INTEGRITY'
} as const;

export type PermissionItem = typeof PermissionItems[keyof typeof PermissionItems];

export const LocalEventTypes = {
  AGENT_DISCOVERED: 'AGENT_DISCOVERED',
  AGENT_SCAN_FAILED: 'AGENT_SCAN_FAILED',
  CONFIG_DISCOVERED: 'CONFIG_DISCOVERED',
  CONFIG_SCAN_FAILED: 'CONFIG_SCAN_FAILED',
  RULE_DISCOVERED: 'RULE_DISCOVERED',
  MEMORY_DISCOVERED: 'MEMORY_DISCOVERED',
  SUBAGENT_DISCOVERED: 'SUBAGENT_DISCOVERED',
  IGNORE_DISCOVERED: 'IGNORE_DISCOVERED',
  SKILL_DISCOVERED: 'SKILL_DISCOVERED',
  MCP_DISCOVERED: 'MCP_DISCOVERED',
  PLUGIN_DISCOVERED: 'PLUGIN_DISCOVERED',
  HOOK_DISCOVERED: 'HOOK_DISCOVERED',
  CLI_DISCOVERED: 'CLI_DISCOVERED',
  KIT_DISCOVERED: 'KIT_DISCOVERED',
  AUDIT_NOT_RUN: 'AUDIT_NOT_RUN',
  AUDIT_FAILED: 'AUDIT_FAILED',
  PATH_ERROR: 'PATH_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  HASH_CHECK_FAILED: 'HASH_CHECK_FAILED',
  AUTH_REVOKED: 'AUTH_REVOKED',
  SECURITY_DELISTED: 'SECURITY_DELISTED',
  SYMLINK_FALLBACK_COPY: 'SYMLINK_FALLBACK_COPY',
  BACKUP_CREATED: 'BACKUP_CREATED',
  ROLLBACK_DONE: 'ROLLBACK_DONE',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  LOCAL_IMPORT: 'LOCAL_IMPORT',
  EVENT_SYNCED: 'EVENT_SYNCED',
  EVENT_SYNC_FAILED: 'EVENT_SYNC_FAILED'
} as const;

export type LocalEventType = typeof LocalEventTypes[keyof typeof LocalEventTypes];

export type ResourceStatusTone = 'ok' | 'warn' | 'danger' | 'info';

export interface PermissionDetail {
  category: PermissionCategory;
  item: PermissionItem;
  label: string;
  target?: string;
  riskLevel?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

export interface PermissionSummary {
  categories: PermissionCategory[];
  items: PermissionItem[];
  label: string;
  declared: boolean;
  details: PermissionDetail[];
  lastExtractedAt?: string;
}

export interface AuditSummary {
  status: AuditStatus;
  trustScore?: number;
  findingCount: number;
  criticalCount: number;
  highCount: number;
  lastAuditedAt?: string;
  message?: string;
}

export interface LocalResource {
  id: string;
  type: LocalResourceType;
  name: string;
  displayName: string;
  description?: string;
  sourceType: LocalResourceSourceType;
  sourceId?: string;
  sourcePath?: string;
  version?: string;
  latestVersion?: string;
  sha256?: string;
  packageHash?: string;
  managed: boolean;
  centralStoreManaged: boolean;
  nativeDirectoryManaged: boolean;
  eaManagedFallback: boolean;
  permissionSummary: PermissionSummary;
  auditSummary: AuditSummary;
  createdAt: string;
  lastScannedAt?: string;
  lastModifiedAt?: string;
  lastEventAt?: string;
  metadata: Record<string, unknown>;
}

export interface ResourceBinding {
  id: string;
  resourceId: string;
  resourceType: LocalResourceType;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  scopeType: ResourceScopeType;
  scopePath?: string;
  targetPath?: string;
  managedMode: ManagedMode;
  writeMode: WriteMode;
  detectionStatus: DetectionStatus;
  lifecycleStatus: LifecycleStatus;
  pathStatus: PathStatus;
  authStatus: AuthStatus;
  auditStatus: AuditStatus;
  driftStatus: DriftStatus;
  operationStatus: OperationStatus;
  syncStatus: SyncStatus;
  lastKnownHash?: string;
  currentHash?: string;
  externalModified: boolean;
  drifted: boolean;
  backupSnapshotId?: string;
  lastExecutionId?: string;
  lastEventAt?: string;
  metadata: Record<string, unknown>;
  updatedAt?: string;
}

export type FileBackedResourceContentType = 'json' | 'toml' | 'yaml' | 'markdown' | 'text' | 'script' | 'binary' | 'unknown';

export interface FileBackedResource {
  resourceId: string;
  bindingId: string;
  path: string;
  contentType: FileBackedResourceContentType;
  size: number;
  lastKnownMtime: string;
  lastKnownSize: number;
  lastKnownHash: string;
  currentHash?: string;
  lastManagedHash?: string;
  externalModified: boolean;
  drifted: boolean;
  previewAvailable: boolean;
  backupSnapshotId?: string;
  metadata?: Record<string, unknown>;
}

export type LocalEventStatus = 'success' | 'failure' | 'partial_success' | 'rolled_back' | 'rollback_failed' | 'info';
export type ServerAckStatus = 'accepted' | 'rejected' | 'ignored';

export interface LocalEventRecord {
  eventId: string;
  idempotencyKey: string;
  eventType: LocalEventType | string;
  operationId?: string;
  executionId?: string;
  resourceId?: string;
  bindingId?: string;
  resourceType?: LocalResourceType;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  status: LocalEventStatus;
  message: string;
  errorCode?: string;
  failureReason?: string;
  suggestion?: string;
  offlineCreated: boolean;
  syncStatus: SyncStatus;
  serverAckStatus?: ServerAckStatus;
  createdAt: string;
  syncedAt?: string;
  metadata: Record<string, unknown>;
}

export interface AggregatedResourceStatus {
  key: string;
  label: string;
  tone: ResourceStatusTone;
  source: string;
}

export interface LocalResourceRow {
  resource: LocalResource;
  binding?: ResourceBinding;
  files: FileBackedResource[];
  events: LocalEventRecord[];
  status: AggregatedResourceStatus;
  scopeLabel: string;
}

export interface LocalResourceSnapshot {
  resources: LocalResource[];
  bindings: ResourceBinding[];
  files: FileBackedResource[];
  events: LocalEventRecord[];
  rows: LocalResourceRow[];
  summary: {
    resourceCount: number;
    bindingCount: number;
    fileCount: number;
    eventCount: number;
    pendingSyncEvents: number;
    failureCount: number;
    lastScannedAt?: string;
    generatedAt: string;
  };
}

export function createEmptyPermissionSummary(label = '未声明'): PermissionSummary {
  return {
    categories: [],
    items: [],
    label,
    declared: false,
    details: []
  };
}

export function createNotAuditedSummary(message = '未运行静态审计'): AuditSummary {
  return {
    status: AuditStatuses.NOT_AUDITED,
    findingCount: 0,
    criticalCount: 0,
    highCount: 0,
    message
  };
}

export function aggregateResourceStatus(input: {
  detectionStatus?: DetectionStatus;
  lifecycleStatus?: LifecycleStatus;
  pathStatus?: PathStatus;
  authStatus?: AuthStatus;
  auditStatus?: AuditStatus;
  driftStatus?: DriftStatus;
  operationStatus?: OperationStatus;
  syncStatus?: SyncStatus;
}): AggregatedResourceStatus {
  if (input.authStatus === AuthStatuses.SECURITY_DELISTED) return status('security_delisted', '安全下架', 'danger', 'authStatus');
  if (input.authStatus === AuthStatuses.AUTH_REVOKED) return status('auth_revoked', '授权收缩', 'warn', 'authStatus');
  if (input.operationStatus === OperationStatuses.ROLLBACK_FAILED) return status('rollback_failed', '回滚失败', 'danger', 'operationStatus');
  if (input.operationStatus === OperationStatuses.FAILURE) return status('failure', '操作失败', 'danger', 'operationStatus');
  if (input.operationStatus === OperationStatuses.PARTIAL_SUCCESS) return status('partial_success', '部分成功', 'warn', 'operationStatus');
  if (input.auditStatus === AuditStatuses.SECURITY_RISK) return status('security_risk', '安全风险', 'danger', 'auditStatus');
  if (input.auditStatus === AuditStatuses.HIGH_RISK) return status('high_risk', '高风险', 'danger', 'auditStatus');
  if (input.pathStatus && ([PathStatuses.MISSING, PathStatuses.NOT_WRITABLE, PathStatuses.INVALID, PathStatuses.CONFLICT] as readonly PathStatus[]).includes(input.pathStatus)) {
    return status(`path_${input.pathStatus.toLowerCase()}`, '路径异常', 'warn', 'pathStatus');
  }
  if (input.driftStatus && ([DriftStatuses.DRIFTED, DriftStatuses.EXTERNALLY_MODIFIED, DriftStatuses.MANAGED_BLOCK_MISSING, DriftStatuses.HASH_CHANGED] as readonly DriftStatus[]).includes(input.driftStatus)) {
    return status(`drift_${input.driftStatus.toLowerCase()}`, '配置漂移', 'warn', 'driftStatus');
  }
  if (input.syncStatus === SyncStatuses.SERVER_REJECTED) return status('server_rejected', '同步失败', 'danger', 'syncStatus');
  if (input.syncStatus === SyncStatuses.SYNC_FAILED) return status('sync_failed', '同步失败', 'warn', 'syncStatus');
  if (input.syncStatus === SyncStatuses.PENDING_SYNC) return status('pending_sync', '待同步', 'info', 'syncStatus');
  if (input.detectionStatus === DetectionStatuses.SCAN_FAILED) return status('scan_failed', '扫描失败', 'danger', 'detectionStatus');
  if (input.lifecycleStatus === LifecycleStatuses.ENABLED) return status('enabled', '已启用', 'ok', 'lifecycleStatus');
  if (input.lifecycleStatus === LifecycleStatuses.CONNECTED) return status('connected', '已接入', 'ok', 'lifecycleStatus');
  if (input.lifecycleStatus === LifecycleStatuses.INSTALLED) return status('installed', '已安装', 'ok', 'lifecycleStatus');
  if (input.lifecycleStatus === LifecycleStatuses.RECORDED) return status('recorded', '已记录', 'info', 'lifecycleStatus');
  if (input.detectionStatus === DetectionStatuses.NOT_DETECTED) return status('not_detected', '未检测', 'info', 'detectionStatus');
  if (input.detectionStatus === DetectionStatuses.NOT_CONFIGURED) return status('not_configured', '未配置', 'info', 'detectionStatus');
  if (input.detectionStatus === DetectionStatuses.DETECTED) return status('detected', '已检测', 'info', 'detectionStatus');
  return status('unknown', '未知', 'info', 'unknown');
}

export function localResourceTypeLabel(type: LocalResourceType | string | undefined): string {
  switch (type) {
    case LocalResourceTypes.AGENT: return '智能体';
    case LocalResourceTypes.AGENT_CONFIG: return '配置';
    case LocalResourceTypes.RULE: return '规则';
    case LocalResourceTypes.MEMORY: return '记忆';
    case LocalResourceTypes.SUBAGENT: return '子智能体';
    case LocalResourceTypes.IGNORE_FILE: return 'Ignore';
    case LocalResourceTypes.SKILL: return 'Skill';
    case LocalResourceTypes.MCP_SERVER: return 'MCP';
    case LocalResourceTypes.PLUGIN: return 'Plugin';
    case LocalResourceTypes.HOOK: return 'Hook';
    case LocalResourceTypes.CLI_COMMAND: return 'CLI';
    case LocalResourceTypes.KIT: return 'Kit';
    case LocalResourceTypes.PROJECT: return '项目';
    case LocalResourceTypes.AUDIT_FINDING: return '审计发现';
    case LocalResourceTypes.LOCAL_EVENT: return '本地事件';
    default: return '资源';
  }
}

export function auditStatusLabel(statusValue: AuditStatus | string | undefined): string {
  switch (statusValue) {
    case AuditStatuses.SAFE: return '正常';
    case AuditStatuses.LOW_RISK: return '低风险';
    case AuditStatuses.NEEDS_REVIEW: return '需复核';
    case AuditStatuses.HIGH_RISK: return '高风险';
    case AuditStatuses.SECURITY_RISK: return '安全风险';
    case AuditStatuses.NOT_AUDITED: return '未审计';
    default: return '未审计';
  }
}

export function scopeTypeLabel(scopeType: ResourceScopeType | string | undefined): string {
  switch (scopeType) {
    case ResourceScopeTypes.GLOBAL: return '全局';
    case ResourceScopeTypes.AGENT_GLOBAL: return '智能体全局';
    case ResourceScopeTypes.PROJECT: return '项目';
    case ResourceScopeTypes.AGENT_PROJECT: return '智能体项目';
    case ResourceScopeTypes.CUSTOM_PATH: return '自定义路径';
    case ResourceScopeTypes.KIT: return '工具集';
    default: return '未指定';
  }
}

export function resourceScopeLabel(binding?: Pick<ResourceBinding, 'agentId' | 'projectId' | 'kitId' | 'scopeType' | 'scopePath'>): string {
  if (!binding) return '未绑定';
  const owner = [binding.agentId, binding.projectId, binding.kitId].filter(Boolean).join(' / ');
  const scope = scopeTypeLabel(binding.scopeType);
  return owner ? `${owner} / ${scope}` : scope;
}

export function contentTypeFromPath(filePath: string): FileBackedResourceContentType {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.md') || lower.endsWith('.mdc')) return 'markdown';
  if (lower.endsWith('.txt')) return 'text';
  if (lower.endsWith('.sh') || lower.endsWith('.ps1') || lower.endsWith('.bat') || lower.endsWith('.cmd')) return 'script';
  return 'unknown';
}

function status(key: string, label: string, tone: ResourceStatusTone, source: string): AggregatedResourceStatus {
  return { key, label, tone, source };
}
