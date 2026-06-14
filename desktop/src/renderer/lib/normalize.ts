import type { CatalogHome, ExtensionKind, ExtensionSummary, LocalLifecycleSnapshot, NotificationItem, PublishResult, SessionUser, UpdateState, VersionSummary } from '../types/desktop';

export function normalizeSessionUser(value: unknown): SessionUser | undefined {
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.user) ? value.user : value;
  return {
    userId: str(source.userId ?? source.userID ?? source.id),
    username: str(source.username ?? source.phone ?? source.account),
    displayName: str(source.displayName ?? source.name ?? source.username ?? source.phone),
    role: str(source.role ?? source.roleCode),
    departmentId: str(source.departmentId ?? source.departmentID),
    mustChangePassword: Boolean(source.mustChangePassword ?? source.forcePasswordChange)
  };
}

export function normalizeCatalogHome(value: unknown): CatalogHome {
  const record = isRecord(value) ? value : {};
  const skills = normalizeMany(firstArray(record.skills, record.skillRankings, record.skillList, bucketItems(record.skill)), 'skill');
  const mcps = normalizeMany(firstArray(record.mcps, record.mcpServers, record.mcpRankings, bucketItems(record.mcpServer), bucketItems(record.mcp)), 'mcp');
  const plugins = normalizeMany(firstArray(record.plugins, record.pluginRankings, record.pluginList, bucketItems(record.plugin)), 'plugin');
  return {
    skills,
    mcps,
    plugins,
    hot: normalizeMany(firstArray(record.hot, record.hotRankings, record.hotExtensions), undefined),
    stars: normalizeMany(firstArray(record.stars, record.starRankings, record.starredRankings), undefined),
    downloads: normalizeMany(firstArray(record.downloads, record.downloadRankings, record.downloadedRankings), undefined)
  };
}

export function normalizeSearchResults(value: unknown): ExtensionSummary[] {
  const record = isRecord(value) ? value : {};
  const raw = firstArray(record.items, record.results, record.content, Array.isArray(value) ? value : undefined);
  return normalizeMany(raw, undefined);
}

export function normalizeExtension(value: unknown, fallbackType?: ExtensionKind): ExtensionSummary {
  const record = isRecord(value) ? value : {};
  const type = normalizeKind(record.type ?? record.extensionType ?? record.kind, fallbackType);
  const id = str(record.extensionId ?? record.extensionID ?? record.id) ?? 'unknown-extension';
  const permission = record.permission ?? record.authorization ?? record.auth;
  const permissionRecord = isRecord(permission) ? permission : {};
  return {
    id,
    type,
    name: str(record.name ?? record.displayName ?? record.title) ?? id,
    summary: str(record.summary ?? record.shortDescription),
    description: str(record.description ?? record.detail),
    version: str(record.version ?? record.currentVersion ?? record.latestVersion),
    publisher: str(record.publisher ?? record.publisherName ?? record.author),
    tags: arrayOfString(record.tags ?? record.keywords),
    starCount: num(record.starCount ?? record.stars),
    downloadCount: num(record.downloadCount ?? record.downloads),
    usageCount: num(record.usageCount ?? record.usage),
    starred: bool(record.starred ?? record.isStarred),
    authorized: bool(record.authorized ?? permissionRecord.authorized ?? record.canUse),
    authorizationMessage: str(record.authorizationMessage ?? permissionRecord.message ?? record.mainOperationDeniedReason),
    status: str(record.status ?? record.localStatus ?? record.reviewStatus),
    riskLevel: str(record.riskLevel ?? record.risk),
    visibilityMode: str(record.visibilityMode ?? record.visibility),
    updatedAt: str(record.updatedAt ?? record.updateTime)
  };
}

export function normalizeVersions(value: unknown): VersionSummary[] {
  const record = isRecord(value) ? value : {};
  const raw = firstArray(record.items, record.versions, record.content, Array.isArray(value) ? value : undefined);
  return raw.map((item) => {
    const row = isRecord(item) ? item : {};
    return {
      version: str(row.version ?? row.versionNo ?? item) ?? 'unknown',
      status: str(row.status),
      createdAt: str(row.createdAt ?? row.createdTime)
    };
  });
}

export function normalizeLifecycle(value: unknown): LocalLifecycleSnapshot {
  const record = isRecord(value) ? value : {};
  return {
    extensions: records(record.extensions),
    versions: records(record.versions),
    targets: records(record.targets),
    tools: records(record.tools),
    projects: records(record.projects),
    mcpInstallations: records(record.mcpInstallations),
    pluginInstallations: records(record.pluginInstallations)
  };
}

export function normalizeNotifications(value: unknown): NotificationItem[] {
  const record = isRecord(value) ? value : {};
  const raw = firstArray(record.items, record.notifications, record.content, Array.isArray(value) ? value : undefined);
  return raw.map((item, index) => {
    const row = isRecord(item) ? item : {};
    return {
      id: str(row.id ?? row.notificationId) ?? `notification-${index}`,
      title: str(row.title ?? row.subject) ?? '通知',
      message: str(row.message ?? row.content),
      read: bool(row.read ?? row.readAt),
      createdAt: str(row.createdAt ?? row.createdTime),
      severity: str(row.severity ?? row.type)
    };
  });
}

export function normalizePublishResult(value: unknown): PublishResult {
  const record = isRecord(value) ? value : {};
  return {
    submissionId: str(record.submissionId ?? record.submissionID ?? record.id),
    revisionId: str(record.revisionId ?? record.revisionID),
    status: str(record.status ?? record.reviewStatus)
  };
}

export function normalizeUpdateState(value: unknown): UpdateState {
  const record = isRecord(value) ? value : {};
  return {
    state: str(record.state ?? (record.updateAvailable ? 'available' : undefined)),
    version: str(record.version),
    releaseNotes: str(record.releaseNotes),
    force: bool(record.force ?? record.forceUpdate)
  };
}

export function groupByKind(items: ExtensionSummary[]): Record<ExtensionKind, ExtensionSummary[]> {
  return {
    skill: items.filter((item) => item.type === 'skill'),
    mcp: items.filter((item) => item.type === 'mcp'),
    plugin: items.filter((item) => item.type === 'plugin')
  };
}

function normalizeMany(items: unknown[], fallbackType?: ExtensionKind): ExtensionSummary[] {
  return items.map((item) => normalizeExtension(item, fallbackType)).filter((item) => item.id !== 'unknown-extension');
}

function normalizeKind(value: unknown, fallback?: ExtensionKind): ExtensionKind {
  const normalized = String(value ?? fallback ?? 'skill').toLowerCase();
  if (normalized.includes('mcp')) return 'mcp';
  if (normalized.includes('plugin')) return 'plugin';
  return 'skill';
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function bucketItems(value: unknown): unknown[] | undefined {
  if (!isRecord(value)) return undefined;
  const keys = ['hot', 'star', 'stars', 'download', 'downloads', 'usage', 'metric', 'items'];
  for (const key of keys) {
    const items = value[key];
    if (Array.isArray(items) && items.length > 0) return items;
  }
  for (const key of keys) {
    const items = value[key];
    if (Array.isArray(items)) return items;
  }
  return undefined;
}

function arrayOfString(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : value === undefined ? undefined : Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
