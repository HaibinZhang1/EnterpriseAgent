import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAppPaths } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { PackageDownloadService } from '../src/main/packages/package-download-service';
import { LocalEventTypes, LocalResourceTypes, PathStatuses } from '../src/shared/local-resources';
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

  it('allows binding-scoped path operations only for paths owned by the binding', async () => {
    const temp = await tempRoot();
    try {
      const dbPath = path.join(temp.root, 'local.db');
      const db = new LocalDatabase(dbPath);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      const codexDir = path.join(temp.root, '.codex');
      const ownedFile = path.join(codexDir, 'config.toml');
      const unownedFile = path.join(temp.root, 'other.toml');
      await mkdir(codexDir, { recursive: true });
      await writeFile(ownedFile, 'api_key = "EAH_SENTINEL_SECRET_DO_NOT_PERSIST"\n', 'utf8');
      await writeFile(unownedFile, 'model = "unowned"\n', 'utf8');
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.AGENT_CONFIG,
        sourceId: 'codex.directory',
        name: 'Codex Directory',
        agentId: 'codex',
        targetPath: codexDir,
        status: 'scanned'
      });
      const snapshot = repo.listResources();
      const binding = snapshot.bindings.find((candidate) => candidate.targetPath === codexDir);
      const resource = snapshot.resources.find((candidate) => candidate.sourceId === 'codex.directory');
      expect(binding).toBeDefined();
      expect(resource).toBeDefined();
      await db.run(
        `INSERT OR REPLACE INTO file_backed_resources(
          id, resource_id, binding_id, path, content_type, size, last_known_mtime,
          last_known_size, last_known_hash, current_hash, external_modified,
          drifted, preview_available, metadata_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'owned-codex-config-file',
          resource!.id,
          binding!.id,
          ownedFile,
          'toml',
          44,
          '2026-06-16T00:00:00.000Z',
          44,
          'owned-hash',
          'owned-hash',
          0,
          0,
          1,
          '{}',
          '2026-06-16T00:00:00.000Z'
        ]
      );

      const allowed = await repo.checkResourcePath({ bindingId: binding!.id, targetPath: ownedFile, operationId: 'owned-path-check' });
      expect(allowed).toMatchObject({ bindingId: binding!.id, targetPath: ownedFile, pathStatus: PathStatuses.OK });
      expect(allowed.eventId).toBeUndefined();
      const preview = await repo.previewResourceFile({ bindingId: binding!.id, targetPath: ownedFile, operationId: 'owned-preview' });
      expect(preview).toMatchObject({ bindingId: binding!.id, targetPath: ownedFile, previewAvailable: true });
      expect(preview.eventId).toBeUndefined();
      expect(preview.redactedContent).not.toContain('EAH_SENTINEL_SECRET_DO_NOT_PERSIST');
      const resourceScoped = await repo.checkResourcePath({ resourceId: resource!.id, targetPath: ownedFile, operationId: 'resource-owned-path-check' });
      expect(resourceScoped).toMatchObject({ bindingId: binding!.id, targetPath: ownedFile, pathStatus: PathStatuses.OK });
      expect(resourceScoped.eventId).toBeUndefined();
      const resourceScopedPreview = await repo.previewResourceFile({ resourceId: resource!.id, targetPath: ownedFile, operationId: 'resource-owned-preview' });
      expect(resourceScopedPreview).toMatchObject({ bindingId: binding!.id, targetPath: ownedFile, previewAvailable: true });
      expect(resourceScopedPreview.eventId).toBeUndefined();

      await expect(repo.checkResourcePath({ bindingId: binding!.id, targetPath: unownedFile }))
        .rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      await expect(repo.previewResourceFile({ bindingId: binding!.id, targetPath: unownedFile }))
        .rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      expect(db.query<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM local_events
         WHERE binding_id = ? AND json_extract(payload_json, '$.targetPath') = ?`,
        [binding!.id, unownedFile]
      )[0].count).toBe(0);
      expect(db.query<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM local_events
         WHERE operation_id IN (?, ?)`,
        ['owned-path-check', 'owned-preview']
      )[0].count).toBe(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('rejects resource-scoped path operations when the resource has no binding owner', async () => {
    const temp = await tempRoot();
    try {
      const dbPath = path.join(temp.root, 'local.db');
      const db = new LocalDatabase(dbPath);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      const orphanFile = path.join(temp.root, 'orphan.toml');
      await writeFile(orphanFile, 'model = "orphan"\n', 'utf8');
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.AGENT_CONFIG,
        sourceId: 'codex.orphan',
        name: 'Orphan Codex Config',
        agentId: 'codex',
        targetPath: orphanFile,
        status: 'scanned'
      });
      const resource = repo.listResources().resources.find((candidate) => candidate.sourceId === 'codex.orphan');
      expect(resource).toBeDefined();
      await db.run('DELETE FROM file_backed_resources WHERE resource_id = ?', [resource!.id]);
      await db.run('DELETE FROM resource_bindings WHERE resource_id = ?', [resource!.id]);

      await expect(repo.checkResourcePath({ resourceId: resource!.id, targetPath: orphanFile, operationId: 'orphan-path-check' }))
        .rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      await expect(repo.previewResourceFile({ resourceId: resource!.id, targetPath: orphanFile, operationId: 'orphan-preview' }))
        .rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      expect(db.query<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM local_events
         WHERE operation_id IN (?, ?)`,
        ['orphan-path-check', 'orphan-preview']
      )[0].count).toBe(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('rejects binding-scoped path operations against another binding on the same resource', async () => {
    const temp = await tempRoot();
    try {
      const dbPath = path.join(temp.root, 'local.db');
      const db = new LocalDatabase(dbPath);
      await db.initialize();
      const repo = new LocalLifecycleRepository(db);
      const firstPath = path.join(temp.root, 'first.toml');
      const secondPath = path.join(temp.root, 'second.toml');
      await writeFile(firstPath, 'model = "first"\n', 'utf8');
      await writeFile(secondPath, 'model = "second"\n', 'utf8');
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.AGENT_CONFIG,
        sourceId: 'codex.multi-binding',
        name: 'Codex Multi Binding',
        agentId: 'codex',
        targetPath: firstPath,
        status: 'scanned'
      });
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.AGENT_CONFIG,
        sourceId: 'codex.multi-binding',
        name: 'Codex Multi Binding',
        agentId: 'codex',
        targetPath: secondPath,
        status: 'scanned'
      });
      const snapshot = repo.listResources();
      const resource = snapshot.resources.find((candidate) => candidate.sourceId === 'codex.multi-binding');
      const firstBinding = snapshot.bindings.find((candidate) => candidate.resourceId === resource?.id && candidate.targetPath === firstPath);
      const secondBinding = snapshot.bindings.find((candidate) => candidate.resourceId === resource?.id && candidate.targetPath === secondPath);
      expect(resource).toMatchObject({ sourcePath: secondPath });
      expect(firstBinding).toBeDefined();
      expect(secondBinding).toBeDefined();

      await expect(repo.checkResourcePath({ bindingId: firstBinding!.id, targetPath: secondPath, operationId: 'cross-binding-path-check' }))
        .rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      await expect(repo.previewResourceFile({ bindingId: firstBinding!.id, targetPath: secondPath, operationId: 'cross-binding-preview' }))
        .rejects.toMatchObject({ desktopError: { code: 'validation_failed' } });
      expect(db.query<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM local_events
         WHERE operation_id IN (?, ?)`,
        ['cross-binding-path-check', 'cross-binding-preview']
      )[0].count).toBe(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
