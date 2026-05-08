import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database, type QueryExecResult, type SqlJsStatic, type SqlValue } from 'sql.js';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

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
  result TEXT,
  error_code TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT
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
    const statement = this.ensureDb().prepare(sql);
    try {
      statement.run(params);
      await this.persist();
    } finally {
      statement.free();
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

  private ensureDb(): Database {
    if (!this.db) throw new DesktopErrorException(makeDesktopError('db_error', 'Local database is not initialized'));
    return this.db;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
