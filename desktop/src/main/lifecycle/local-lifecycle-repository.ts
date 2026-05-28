import type { LocalDatabase } from '../db/local-database';
import { redactForLog } from '../../shared/redaction';

export interface LocalLifecycleStateHint {
  extensionId: string;
  state: string;
  message?: string;
}

export interface LocalLifecycleHintApplySummary {
  applied: number;
  ignored: number;
}

export interface LocalLifecycleSnapshot {
  extensions: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  targets: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  mcpInstallations: Array<Record<string, unknown>>;
  pluginInstallations: Array<Record<string, unknown>>;
}

export interface LocalMcpInstallationRecord {
  id: string;
  extensionId: string;
  target: string;
  status: string;
  configPath?: string;
  secureRef?: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScannedLocalExtensionRecord {
  extensionId: string;
  name?: string;
  summary?: string;
  version?: string;
  target?: string;
  kind?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export class LocalLifecycleRepository {
  constructor(private readonly db: LocalDatabase) {}

  list(): LocalLifecycleSnapshot {
    return {
      extensions: this.db.query<Record<string, unknown>>(
        `SELECT extension_id as extensionId, name, summary, visibility, status, cached_at as cachedAt, updated_at as updatedAt
         FROM local_extensions ORDER BY updated_at DESC`
      ),
      versions: this.db.query<Record<string, unknown>>(
        `SELECT extension_id as extensionId, version, package_sha256 as packageSha256, status, cached_at as cachedAt, updated_at as updatedAt
         FROM local_extension_versions ORDER BY updated_at DESC`
      ),
      targets: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, status, metadata_json as metadataJson, updated_at as updatedAt
         FROM local_targets ORDER BY updated_at DESC`
      )),
      tools: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, tool_name as toolName, status, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM local_tools ORDER BY updated_at DESC`
      )),
      projects: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT project_id as projectId, name, extension_id as extensionId, status, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM local_projects ORDER BY updated_at DESC`
      )),
      mcpInstallations: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, status, config_path as configPath, secure_ref as secureRef, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM mcp_local_installations ORDER BY updated_at DESC`
      )),
      pluginInstallations: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, status, adapter_id as adapterId, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM plugin_local_installations ORDER BY updated_at DESC`
      ))
    };
  }

  async recordSkillInstalled(input: { extensionId: string; version: string; packageSha256?: string; name?: string; summary?: string }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO local_extensions(extension_id, name, summary, visibility, status, cached_at, updated_at)
       VALUES (?, ?, ?, 'authorized_cache', 'installed', ?, ?)`,
      [input.extensionId, input.name ?? input.extensionId, input.summary ?? null, now, now]
    );
    await this.db.run(
      `INSERT OR REPLACE INTO local_extension_versions(extension_id, version, package_sha256, status, cached_at, updated_at)
       VALUES (?, ?, ?, 'installed', ?, ?)`,
      [input.extensionId, input.version, input.packageSha256 ?? null, now, now]
    );
  }

  async recordScannedExtension(input: ScannedLocalExtensionRecord): Promise<void> {
    const now = new Date().toISOString();
    const status = input.status ?? 'scanned';
    await this.db.run(
      `INSERT OR REPLACE INTO local_extensions(extension_id, name, summary, visibility, status, cached_at, updated_at)
       VALUES (?, ?, ?, 'local_scan', ?, ?, ?)`,
      [input.extensionId, input.name ?? input.extensionId, input.summary ?? null, status, now, now]
    );
    if (input.version) {
      await this.db.run(
        `INSERT OR REPLACE INTO local_extension_versions(extension_id, version, package_sha256, status, cached_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?)`,
        [input.extensionId, input.version, status, now, now]
      );
    }
    if (input.target) {
      await this.recordTarget({
        extensionId: input.extensionId,
        target: input.target,
        status,
        metadata: {
          ...(input.metadata ?? {}),
          kind: input.kind,
          discoveredBy: 'local_inventory_scan'
        }
      });
    }
  }

  async recordScannedTool(input: { extensionId: string; target: string; toolName: string; status?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO local_tools(id, extension_id, target, tool_name, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localId('tool', input.extensionId, `${input.target}:${input.toolName}`),
        input.extensionId,
        input.target,
        input.toolName,
        input.status ?? 'scanned',
        JSON.stringify(redactForLog({ ...(input.metadata ?? {}), discoveredBy: 'local_inventory_scan' })),
        now,
        now
      ]
    );
  }

  async recordScannedProject(input: { projectId: string; name: string; extensionId?: string; status?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO local_projects(project_id, name, extension_id, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.projectId,
        input.name,
        input.extensionId ?? null,
        input.status ?? 'scanned',
        JSON.stringify(redactForLog({ ...(input.metadata ?? {}), discoveredBy: 'local_inventory_scan' })),
        now,
        now
      ]
    );
  }

  async recordTarget(input: { extensionId: string; target: string; status: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO local_targets(id, extension_id, target, status, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`target_${input.extensionId}_${input.target}`, input.extensionId, input.target, input.status, JSON.stringify(redactForLog(input.metadata ?? {})), now]
    );
  }

  async recordMcpInstallation(input: { extensionId: string; target: string; status: string; configPath?: string; secureRef?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO mcp_local_installations(id, extension_id, target, status, config_path, secure_ref, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [localId('mcp', input.extensionId, input.target), input.extensionId, input.target, input.status, input.configPath ?? null, input.secureRef ?? null, JSON.stringify(redactForLog(input.metadata ?? {}))]
    );
  }

  findMcpInstallation(extensionId: string, target: string): LocalMcpInstallationRecord | undefined {
    const row = this.db.query<Record<string, unknown>>(
      `SELECT id, extension_id as extensionId, target, status, config_path as configPath, secure_ref as secureRef, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
       FROM mcp_local_installations
       WHERE extension_id = ? AND (target = ? OR config_path = ?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [extensionId, target, target]
    )[0];
    if (!row) return undefined;
    const metadata = typeof row.metadataJson === 'string' ? safeParseJson(row.metadataJson) : {};
    return {
      id: String(row.id),
      extensionId: String(row.extensionId),
      target: String(row.target),
      status: String(row.status),
      configPath: typeof row.configPath === 'string' ? row.configPath : undefined,
      secureRef: typeof row.secureRef === 'string' ? row.secureRef : undefined,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {},
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined
    };
  }

  async recordPluginInstallation(input: { extensionId: string; target: string; status: string; adapterId?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO plugin_local_installations(id, extension_id, target, status, adapter_id, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [localId('plugin', input.extensionId, input.target), input.extensionId, input.target, input.status, input.adapterId ?? null, JSON.stringify(redactForLog(input.metadata ?? {}))]
    );
  }

  async markCleaned(input: { extensionId: string; target?: string; kind?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    const metadata = JSON.stringify(redactForLog({ ...(input.metadata ?? {}), cleanedAt: now }));
    const args = input.target
      ? ['cleaned', metadata, now, input.extensionId, input.target]
      : ['cleaned', now, input.extensionId];
    if (input.kind === 'mcp' && input.target) {
      await this.db.run(`UPDATE mcp_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ? AND (target = ? OR config_path = ?)`, [...args, input.target]);
      return;
    }
    if (input.kind === 'plugin' && input.target) {
      await this.db.run(`UPDATE plugin_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ? AND target = ?`, args);
      return;
    }
    if (input.target) {
      await this.db.run(`UPDATE local_targets SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ? AND target = ?`, args);
      return;
    }
    await this.db.run(`UPDATE local_extensions SET status = ?, updated_at = ? WHERE extension_id = ?`, args);
    await this.db.run(`UPDATE local_extension_versions SET status = ?, updated_at = ? WHERE extension_id = ?`, args);
  }

  async applyServerStateHints(hints: LocalLifecycleStateHint[]): Promise<LocalLifecycleHintApplySummary> {
    const strongestByExtension = new Map<string, { status: string; hint: LocalLifecycleStateHint; precedence: number }>();
    let ignored = 0;
    let recognized = 0;
    for (const hint of hints) {
      const mapped = mapHintState(hint.state);
      if (!mapped) {
        ignored += 1;
        continue;
      }
      recognized += 1;
      const current = strongestByExtension.get(hint.extensionId);
      if (!current || mapped.precedence < current.precedence) {
        strongestByExtension.set(hint.extensionId, { ...mapped, hint });
      }
    }

    for (const [extensionId, mapped] of strongestByExtension) {
      await this.applyStatus(extensionId, mapped.status, mapped.hint);
    }

    return { applied: strongestByExtension.size, ignored: ignored + recognized - strongestByExtension.size };
  }

  private async applyStatus(extensionId: string, status: string, hint: LocalLifecycleStateHint): Promise<void> {
    const now = new Date().toISOString();
    const metadata = JSON.stringify(redactForLog({ serverStateHint: hint.state, message: hint.message, appliedAt: now }));
    await this.db.run(`UPDATE local_extensions SET status = ?, updated_at = ? WHERE extension_id = ?`, [status, now, extensionId]);
    await this.db.run(`UPDATE local_extension_versions SET status = ?, updated_at = ? WHERE extension_id = ?`, [status, now, extensionId]);
    await this.db.run(`UPDATE local_targets SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ?`, [status, metadata, now, extensionId]);
    await this.db.run(`UPDATE mcp_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ?`, [status, metadata, now, extensionId]);
    await this.db.run(`UPDATE plugin_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ?`, [status, metadata, now, extensionId]);
  }
}

function localId(prefix: string, extensionId: string, target: string): string {
  return `${prefix}_${Buffer.from(`${extensionId}:${target}`).toString('base64url')}`;
}

function withMetadata(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const metadata = typeof row.metadataJson === 'string' ? safeParseJson(row.metadataJson) : {};
    const { metadataJson: _metadataJson, ...rest } = row;
    return { ...rest, metadata };
  });
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function mapHintState(state: string): { status: string; precedence: number } | undefined {
  const normalized = state.toUpperCase();
  if (['SECURITY_DELISTED', 'SECURITY_BLOCK', 'SECURITY_BLOCKED', 'SECURITY_RISK'].includes(normalized)) {
    return { status: 'security_blocked', precedence: 1 };
  }
  if (['AUTHORIZATION_SHRINK', 'AUTHORIZATION_REDUCED', 'SCOPE_REDUCED', 'SCOPE_SHRINK'].includes(normalized)) {
    return { status: 'scope_reduced', precedence: 2 };
  }
  if (['DELISTED', 'UNAVAILABLE', 'REMOVED'].includes(normalized)) {
    return { status: 'delisted', precedence: 3 };
  }
  if (['VERSION_REFRESH', 'METADATA_REFRESH', 'REFRESH'].includes(normalized)) {
    return { status: 'metadata_refresh', precedence: 4 };
  }
  if (['INFO', 'INFORMATIONAL'].includes(normalized)) {
    return { status: 'server_hint_info', precedence: 5 };
  }
  return undefined;
}
