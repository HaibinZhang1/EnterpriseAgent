import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAppPaths } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { PackageDownloadService } from '../src/main/packages/package-download-service';
import { tempRoot } from './test-utils';

describe('Package download and local lifecycle repository', () => {
  it('downloads package bytes to temp and records installed local state without plaintext secrets', async () => {
    const temp = await tempRoot();
    try {
      const paths = buildAppPaths(temp.root);
      const download = new PackageDownloadService({
        downloadPackage: async () => new TextEncoder().encode('package bytes').buffer
      }, paths);
      const filePath = await download.downloadToTemp('ticket-secret', '../skill.zip', 'req_pkg');
      expect(filePath).toBe(path.join(paths.tempDir, 'skill.zip'));
      expect(await readFile(filePath, 'utf8')).toBe('package bytes');

      const db = new LocalDatabase(path.join(temp.root, 'local.db'));
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      await repo.recordSkillInstalled({ extensionId: 'skill-a', version: '1.0.0', packageSha256: createHash('sha256').update('package bytes').digest('hex') });
      await repo.recordMcpInstallation({ extensionId: 'mcp-a', target: 'codex', status: 'connected', secureRef: 'mcp.variable.mcp-a.apiKey', metadata: { apiKey: 'EAH_SENTINEL_SECRET_DO_NOT_PERSIST' } });
      await repo.recordMcpInstallation({ extensionId: 'mcp-a', target: 'codex', status: 'updated', secureRef: 'mcp.variable.mcp-a.apiKey' });
      await repo.recordPluginInstallation({ extensionId: 'plugin-a', target: 'codex', status: 'installed', adapterId: 'custom-directory', metadata: { token: 'EAH_SENTINEL_SECRET_DO_NOT_PERSIST' } });

      expect(db.query<{ status: string }>('SELECT status FROM local_extension_versions WHERE extension_id = ?', ['skill-a'])[0].status).toBe('installed');
      expect(db.query<{ status: string }>('SELECT status FROM mcp_local_installations WHERE extension_id = ?', ['mcp-a'])).toEqual([{ status: 'updated' }]);
      expect(JSON.stringify(db.query('SELECT metadata_json FROM mcp_local_installations'))).not.toContain('EAH_SENTINEL_SECRET_DO_NOT_PERSIST');
      expect(JSON.stringify(db.query('SELECT metadata_json FROM plugin_local_installations'))).not.toContain('EAH_SENTINEL_SECRET_DO_NOT_PERSIST');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('backfills legacy Skill MCP and Plugin rows into the unified resource graph', async () => {
    const temp = await tempRoot();
    try {
      const dbPath = path.join(temp.root, 'local.db');
      const db = new LocalDatabase(dbPath);
      await db.initialize();
      const now = '2026-06-15T00:00:00.000Z';
      await db.run(
        `INSERT INTO local_extensions(extension_id, name, summary, visibility, status, cached_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['skill.legacy', 'Legacy Skill', 'Old skill row', 'local_scan', 'installed', now, now]
      );
      await db.run(
        `INSERT INTO local_extension_versions(extension_id, version, package_sha256, status, cached_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['skill.legacy', '1.0.0', 'legacy-sha', 'installed', now, now]
      );
      await db.run(
        `INSERT INTO local_targets(id, extension_id, target, status, metadata_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['target-skill-legacy', 'skill.legacy', '/tmp/legacy-skill', 'failed', JSON.stringify({ kind: 'skill', adapterId: 'codex' }), now]
      );
      await db.run(
        `INSERT INTO mcp_local_installations(id, extension_id, target, status, config_path, secure_ref, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['mcp-legacy', 'mcp.legacy', 'codex', 'connected', '/tmp/mcp.json', 'secure.ref', '{}', now, now]
      );
      await db.run(
        `INSERT INTO plugin_local_installations(id, extension_id, target, status, adapter_id, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['plugin-legacy', 'plugin.legacy', 'codex', 'installed', 'manual', '{}', now, now]
      );

      const repo = new LocalLifecycleRepository(db);
      await repo.recordScannedExtension({
        kind: 'plugin',
        extensionId: 'plugin.new',
        name: 'New Plugin',
        target: '/tmp/new-plugin',
        status: 'scanned',
        metadata: { kind: 'plugin' }
      });
      const snapshot = repo.listResources();

      expect(snapshot.resources.map((resource) => resource.type)).toEqual(expect.arrayContaining(['SKILL', 'MCP_SERVER', 'PLUGIN']));
      expect(snapshot.bindings.map((binding) => binding.resourceType)).toEqual(expect.arrayContaining(['SKILL', 'MCP_SERVER', 'PLUGIN']));
      expect(snapshot.resources.map((resource) => resource.sourceId)).toEqual(expect.arrayContaining(['plugin.new', 'skill.legacy', 'mcp.legacy', 'plugin.legacy']));
      expect(snapshot.resources.find((resource) => resource.sourceId === 'skill.legacy')).toMatchObject({
        name: 'Legacy Skill',
        version: '1.0.0',
        packageHash: 'legacy-sha',
        metadata: expect.objectContaining({ legacyBackfill: true, legacyTable: 'local_extensions' })
      });
      expect(snapshot.bindings.find((binding) => binding.targetPath === '/tmp/legacy-skill')).toMatchObject({
        resourceType: 'SKILL',
        detectionStatus: 'SCAN_FAILED',
        operationStatus: 'FAILURE',
        metadata: expect.objectContaining({ legacyBackfill: true })
      });
      expect(snapshot.bindings.find((binding) => binding.resourceType === 'MCP_SERVER')).toMatchObject({
        lifecycleStatus: 'CONNECTED',
        pathStatus: 'UNKNOWN'
      });
      expect(snapshot.files).toHaveLength(0);
      await db.close();

      const reopened = new LocalDatabase(dbPath);
      await reopened.initialize();
      const persisted = new LocalLifecycleRepository(reopened).listResources();
      expect(persisted.resources.map((resource) => resource.sourceId)).toEqual(expect.arrayContaining(['skill.legacy', 'mcp.legacy', 'plugin.legacy']));
      await reopened.close();
    } finally {
      await temp.cleanup();
    }
  });
});
