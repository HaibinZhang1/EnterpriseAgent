import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type QueryExecResult, type SqlJsStatic, type SqlValue } from 'sql.js';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

export interface LocalDatabaseTransaction {
  run(sql: string, params?: SqlValue[]): void;
  query<T extends object>(sql: string, params?: SqlValue[]): T[];
}

let sqlPromise: Promise<SqlJsStatic> | undefined;

async function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({
    locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
  });
  return sqlPromise;
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_extensions (
  extension_id TEXT PRIMARY KEY,
  name TEXT,
  summary TEXT,
  visibility TEXT,
  status TEXT NOT NULL DEFAULT 'cached',
  cached_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_extension_versions (
  extension_id TEXT NOT NULL,
  version TEXT NOT NULL,
  package_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'cached',
  cached_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (extension_id, version)
);

CREATE TABLE IF NOT EXISTS local_targets (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_tools (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  target TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(extension_id, target, tool_name)
);

CREATE TABLE IF NOT EXISTS local_projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  extension_id TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  user_id TEXT,
  extension_id TEXT,
  version TEXT,
  event_type TEXT NOT NULL,
  operation_id TEXT,
  execution_id TEXT,
  resource_id TEXT,
  binding_id TEXT,
  resource_type TEXT,
  agent_id TEXT,
  project_id TEXT,
  kit_id TEXT,
  result TEXT,
  error_code TEXT,
  failure_reason TEXT,
  suggestion TEXT,
  offline_created INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'PENDING_SYNC',
  server_ack_status TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS local_resources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_path TEXT,
  version TEXT,
  latest_version TEXT,
  sha256 TEXT,
  package_hash TEXT,
  managed INTEGER NOT NULL DEFAULT 0,
  central_store_managed INTEGER NOT NULL DEFAULT 0,
  native_directory_managed INTEGER NOT NULL DEFAULT 0,
  ea_managed_fallback INTEGER NOT NULL DEFAULT 0,
  permission_summary_json TEXT NOT NULL DEFAULT '{}',
  audit_summary_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  last_scanned_at TEXT,
  last_modified_at TEXT,
  last_event_at TEXT
);

CREATE TABLE IF NOT EXISTS resource_bindings (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  kit_id TEXT,
  scope_type TEXT NOT NULL,
  scope_path TEXT,
  target_path TEXT,
  managed_mode TEXT NOT NULL,
  write_mode TEXT NOT NULL,
  detection_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  path_status TEXT NOT NULL,
  auth_status TEXT NOT NULL,
  audit_status TEXT NOT NULL,
  drift_status TEXT NOT NULL,
  operation_status TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  last_known_hash TEXT,
  current_hash TEXT,
  external_modified INTEGER NOT NULL DEFAULT 0,
  drifted INTEGER NOT NULL DEFAULT 0,
  backup_snapshot_id TEXT,
  last_execution_id TEXT,
  last_event_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(resource_id) REFERENCES local_resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS file_backed_resources (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  last_known_mtime TEXT NOT NULL,
  last_known_size INTEGER NOT NULL DEFAULT 0,
  last_known_hash TEXT NOT NULL,
  current_hash TEXT,
  last_managed_hash TEXT,
  external_modified INTEGER NOT NULL DEFAULT 0,
  drifted INTEGER NOT NULL DEFAULT 0,
  preview_available INTEGER NOT NULL DEFAULT 0,
  backup_snapshot_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(resource_id) REFERENCES local_resources(id) ON DELETE CASCADE,
  FOREIGN KEY(binding_id) REFERENCES resource_bindings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_audit_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  harness_rule_id TEXT,
  resource_id TEXT NOT NULL,
  binding_id TEXT,
  resource_type TEXT NOT NULL,
  agent_id TEXT,
  project_id TEXT,
  kit_id TEXT,
  severity TEXT NOT NULL,
  audit_status TEXT NOT NULL,
  trust_score_impact INTEGER NOT NULL,
  permission_category TEXT NOT NULL,
  path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  snippet_hash TEXT,
  path_summary TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  impact_scope_json TEXT NOT NULL DEFAULT '{}',
  remediation TEXT NOT NULL,
  related_event_ids_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  blocker INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(resource_id) REFERENCES local_resources(id) ON DELETE CASCADE,
  FOREIGN KEY(binding_id) REFERENCES resource_bindings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_local_installations (
  id TEXT PRIMARY KEY,
  extension_id TEXT,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  config_path TEXT,
  secure_ref TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_local_installations (
  id TEXT PRIMARY KEY,
  extension_id TEXT,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  adapter_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_plans (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_records (
  id TEXT PRIMARY KEY,
  plan_id TEXT,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_cache (
  cache_key TEXT PRIMARY KEY,
  extension_id TEXT,
  version TEXT,
  sha256 TEXT,
  file_path TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_events_idempotency_key ON local_events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_local_events_status ON local_events(status);
CREATE INDEX IF NOT EXISTS idx_local_events_extension_id ON local_events(extension_id);
CREATE INDEX IF NOT EXISTS idx_local_events_resource_id ON local_events(resource_id);
CREATE INDEX IF NOT EXISTS idx_local_events_resource_type ON local_events(resource_type);
CREATE INDEX IF NOT EXISTS idx_local_events_project_id ON local_events(project_id);
CREATE INDEX IF NOT EXISTS idx_local_events_sync_status ON local_events(sync_status);
CREATE INDEX IF NOT EXISTS idx_local_resources_type ON local_resources(type);
CREATE INDEX IF NOT EXISTS idx_local_resources_source_type ON local_resources(source_type);
CREATE INDEX IF NOT EXISTS idx_local_resources_last_scanned_at ON local_resources(last_scanned_at);
CREATE INDEX IF NOT EXISTS idx_resource_bindings_resource_id ON resource_bindings(resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_bindings_resource_type ON resource_bindings(resource_type);
CREATE INDEX IF NOT EXISTS idx_resource_bindings_agent_id ON resource_bindings(agent_id);
CREATE INDEX IF NOT EXISTS idx_resource_bindings_project_id ON resource_bindings(project_id);
CREATE INDEX IF NOT EXISTS idx_resource_bindings_scope_type ON resource_bindings(scope_type);
CREATE INDEX IF NOT EXISTS idx_resource_bindings_detection_status ON resource_bindings(detection_status);
CREATE INDEX IF NOT EXISTS idx_resource_bindings_audit_status ON resource_bindings(audit_status);
CREATE INDEX IF NOT EXISTS idx_file_backed_resources_resource_id ON file_backed_resources(resource_id);
CREATE INDEX IF NOT EXISTS idx_file_backed_resources_binding_id ON file_backed_resources(binding_id);
CREATE INDEX IF NOT EXISTS idx_file_backed_resources_path ON file_backed_resources(path);
CREATE INDEX IF NOT EXISTS idx_local_audit_findings_resource_id ON local_audit_findings(resource_id);
CREATE INDEX IF NOT EXISTS idx_local_audit_findings_binding_id ON local_audit_findings(binding_id);
CREATE INDEX IF NOT EXISTS idx_local_audit_findings_rule_id ON local_audit_findings(rule_id);
CREATE INDEX IF NOT EXISTS idx_local_audit_findings_severity ON local_audit_findings(severity);
CREATE INDEX IF NOT EXISTS idx_local_audit_findings_audit_status ON local_audit_findings(audit_status);
CREATE INDEX IF NOT EXISTS idx_local_audit_findings_detected_at ON local_audit_findings(detected_at);
CREATE INDEX IF NOT EXISTS idx_local_targets_extension_id ON local_targets(extension_id);
CREATE INDEX IF NOT EXISTS idx_local_targets_target ON local_targets(target);
CREATE INDEX IF NOT EXISTS idx_local_targets_status ON local_targets(status);
CREATE INDEX IF NOT EXISTS idx_local_tools_extension_id ON local_tools(extension_id);
CREATE INDEX IF NOT EXISTS idx_local_tools_target ON local_tools(target);
CREATE INDEX IF NOT EXISTS idx_local_tools_status ON local_tools(status);
CREATE INDEX IF NOT EXISTS idx_download_cache_status ON download_cache(status);
INSERT OR IGNORE INTO schema_migrations(version, name, applied_at) VALUES (1, 'm6_initial_local_foundation', datetime('now'));
`;

export class LocalDatabase {
  private db?: Database;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const SQL = await loadSql();
      const bytes = await this.readExistingBytes();
      this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
      this.db.exec(MIGRATION_SQL);
      this.ensureColumns('local_events', {
        operation_id: 'TEXT',
        execution_id: 'TEXT',
        resource_id: 'TEXT',
        binding_id: 'TEXT',
        resource_type: 'TEXT',
        agent_id: 'TEXT',
        project_id: 'TEXT',
        kit_id: 'TEXT',
        failure_reason: 'TEXT',
        suggestion: 'TEXT',
        offline_created: 'INTEGER NOT NULL DEFAULT 1',
        sync_status: "TEXT NOT NULL DEFAULT 'PENDING_SYNC'",
        server_ack_status: 'TEXT'
      });
      this.deleteNonSyncLocalEvents();
      await this.persist();
    } catch (error) {
      throw new DesktopErrorException(makeDesktopError('db_error', 'Failed to initialize local SQLite database', undefined, error));
    }
  }

  query<T extends object>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.ensureDb().prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  async run(sql: string, params: SqlValue[] = []): Promise<void> {
    this.runStatement(sql, params);
    await this.persist();
  }

  runSync(sql: string, params: SqlValue[] = []): void {
    this.runStatement(sql, params);
    this.persistSync();
  }

  async transaction<T>(work: (tx: LocalDatabaseTransaction) => T | Promise<T>): Promise<T> {
    const db = this.ensureDb();
    db.exec('BEGIN IMMEDIATE TRANSACTION');
    const tx: LocalDatabaseTransaction = {
      run: (sql, params = []) => this.runStatement(sql, params),
      query: <Row extends object>(sql: string, params: SqlValue[] = []) => this.query<Row>(sql, params)
    };
    try {
      const result = await work(tx);
      db.exec('COMMIT');
      await this.persist();
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original transaction failure for callers.
      }
      await this.persist();
      throw error;
    }
  }

  async exec(sql: string): Promise<void> {
    this.ensureDb().exec(sql);
    await this.persist();
  }

  exportQuery(sql: string): QueryExecResult[] {
    return this.ensureDb().exec(sql);
  }

  async close(): Promise<void> {
    if (!this.db) return;
    await this.persist();
    this.db.close();
    this.db = undefined;
  }

  private async readExistingBytes(): Promise<Uint8Array | undefined> {
    try {
      const fileStat = await stat(this.filePath);
      if (fileStat.size === 0) return undefined;
      return new Uint8Array(await readFile(this.filePath));
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  private async persist(): Promise<void> {
    const data = this.ensureDb().export();
    await writeFile(this.filePath, Buffer.from(data));
  }

  private persistSync(): void {
    const data = this.ensureDb().export();
    writeFileSync(this.filePath, Buffer.from(data));
  }

  private ensureDb(): Database {
    if (!this.db) throw new DesktopErrorException(makeDesktopError('db_error', 'Local database is not initialized'));
    return this.db;
  }

  private runStatement(sql: string, params: SqlValue[] = []): void {
    const statement = this.ensureDb().prepare(sql);
    try {
      statement.run(params);
    } finally {
      statement.free();
    }
  }

  private ensureColumns(table: string, columns: Record<string, string>): void {
    const existing = new Set(this.query<{ name: string }>(`PRAGMA table_info(${table})`).map((row) => row.name));
    for (const [name, definition] of Object.entries(columns)) {
      if (existing.has(name)) continue;
      this.ensureDb().exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }

  private deleteNonSyncLocalEvents(): void {
    this.runStatement(
      `DELETE FROM local_events
       WHERE status NOT IN ('pending', 'retryable')
          OR sync_status NOT IN ('PENDING_SYNC', 'SYNC_FAILED')`
    );
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
