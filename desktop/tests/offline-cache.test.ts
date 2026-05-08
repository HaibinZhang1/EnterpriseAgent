import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CacheRepository } from '../src/main/cache/cache-repository';
import { OfflinePolicy } from '../src/main/cache/offline-policy';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { tempRoot } from './test-utils';

describe('cache and offline policy', () => {
  it('redacts cache values and preserves server authority while offline', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const cache = new CacheRepository(paths);
      await cache.writeCache('download-ticket', { extensionID: 'ext', downloadTicket: 'ticket-123', status: 'cached' });
      const fileText = await readFile(path.join(paths.cacheDir, 'download-ticket.json'), 'utf8');
      expect(fileText).not.toContain('ticket-123');
      expect(await cache.readCache<{ status: string }>('download-ticket')).toMatchObject({ status: 'cached' });

      const policy = new OfflinePolicy();
      expect(policy.decide('catalog.read', false).allowed).toBe(true);
      expect(policy.decide('local.uninstall.entry', false).allowed).toBe(true);
      const denied = policy.decide('extension.install', false, 'req_offline');
      expect(denied.allowed).toBe(false);
      expect(denied.error).toMatchObject({ code: 'offline_server_authority_required', requestID: 'req_offline' });
    } finally {
      await temp.cleanup();
    }
  });
});
