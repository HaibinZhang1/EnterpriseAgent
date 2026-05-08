import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { tempRoot } from './test-utils';

const REQUIRED_TABLES = [
  'local_extensions',
  'local_extension_versions',
  'local_tools',
  'local_projects',
  'local_events',
  'local_targets',
  'mcp_local_installations',
  'plugin_local_installations',
  'execution_plans',
  'execution_records',
  'download_cache'
];

describe('LocalDatabase migrations', () => {
  it('creates all M6 tables and required indexes from an empty database', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const tables = db.query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name);
      for (const table of REQUIRED_TABLES) expect(tables).toContain(table);

      const indexes = db.query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`).map((row) => row.name);
      expect(indexes).toContain('idx_local_events_idempotency_key');
      expect(indexes).toContain('idx_local_targets_extension_id');
      expect(indexes).toContain('idx_local_targets_target');
      expect(indexes).toContain('idx_local_targets_status');
      expect(indexes).toContain('idx_local_tools_extension_id');
      expect(indexes).toContain('idx_local_tools_target');
      expect(indexes).toContain('idx_local_tools_status');

      const localToolColumns = db.query<{ name: string }>(`PRAGMA table_info(local_tools)`).map((row) => row.name);
      expect(new Set(localToolColumns).size).toBe(localToolColumns.length);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('enforces event idempotency key uniqueness and can reopen existing DB', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      await db.run(
        `INSERT INTO local_events(id, idempotency_key, device_id, event_type, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'pending', ?, ?)`,
        ['evt1', 'same-key', 'device_1', 'test', 'now', 'now']
      );
      await expect(db.run(
        `INSERT INTO local_events(id, idempotency_key, device_id, event_type, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'pending', ?, ?)`,
        ['evt2', 'same-key', 'device_1', 'test', 'now', 'now']
      )).rejects.toThrow();
      await db.close();

      const reopened = new LocalDatabase(paths.localDbFile);
      await reopened.initialize();
      expect(reopened.query<{ count: number }>(`SELECT COUNT(*) as count FROM local_events`)[0].count).toBe(1);
      await reopened.close();
    } finally {
      await temp.cleanup();
    }
  });
});
