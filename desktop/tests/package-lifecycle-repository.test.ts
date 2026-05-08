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
});
