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

export class LocalLifecycleRepository {
  constructor(private readonly db: LocalDatabase) {}

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

  async recordPluginInstallation(input: { extensionId: string; target: string; status: string; adapterId?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO plugin_local_installations(id, extension_id, target, status, adapter_id, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [localId('plugin', input.extensionId, input.target), input.extensionId, input.target, input.status, input.adapterId ?? null, JSON.stringify(redactForLog(input.metadata ?? {}))]
    );
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
