import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import rendererConfig from '../vite.config';
import preloadConfig from '../vite.preload.config';
import { createMainWindowOptions, createManagedMainWindow, MainWindowRegistry } from '../src/main/main-window';
import { createDesktopServices } from '../src/main/services';
import { clearStartupSession, createStartupRecoveryRouter } from '../src/main/startup-recovery';
import { IPC_CHANNELS } from '../src/main/ipc/channels';
import { createPreloadApi } from '../src/preload/api';
import { tempRoot } from './test-utils';
import type { BrowserWindowConstructorOptions } from 'electron';

describe('Electron smoke boundaries', () => {
  it('configures renderer isolation and preload path', () => {
    const options = createMainWindowOptions('/tmp/dist/main');
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.preload).toContain('preload.js');
  });

  it('retains the main BrowserWindow until it closes', () => {
    let closed: (() => void) | undefined;
    const window = {
      on: (event: 'closed', listener: () => void) => {
        if (event === 'closed') closed = listener;
      }
    };
    const registry = new MainWindowRegistry<typeof window>();

    expect(registry.retain(window)).toBe(window);
    expect(registry.current()).toBe(window);
    closed?.();
    expect(registry.current()).toBeUndefined();
  });

  it('creates a managed production window with retained lifecycle and preload options', () => {
    let closed: (() => void) | undefined;
    class FakeWindow {
      constructor(public readonly options: BrowserWindowConstructorOptions) {}
      on(event: 'closed', listener: () => void) {
        if (event === 'closed') closed = listener;
      }
    }
    const registry = new MainWindowRegistry<FakeWindow>();

    const window = createManagedMainWindow(FakeWindow, registry, '/tmp/dist/main');

    expect(registry.current()).toBe(window);
    expect(window.options.webPreferences?.preload).toContain('preload.js');
    expect(window.options.webPreferences?.contextIsolation).toBe(true);
    closed?.();
    expect(registry.current()).toBeUndefined();
  });

  it('composes main services with a temp root and minimal preload call path', async () => {
    const temp = await tempRoot();
    try {
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl: async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }) });
      const api = createPreloadApi((channel, payload, requestID) => services.router.invoke(channel, payload, { requestID }));
      const result = await api.device.getInfo('req_smoke');
      expect(result.success).toBe(true);
      expect(result.requestID).toBe('req_smoke');
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps startup recovery IPC available when full services are not ready', async () => {
    const temp = await tempRoot();
    try {
      const secureStoreFile = path.join(temp.root, 'secure-store.json');
      const localDbFile = path.join(temp.root, 'local.db');
      await writeFile(secureStoreFile, JSON.stringify({
        entries: {
          'session.token': { encrypted: 'session-cipher', updatedAt: '2026-06-11T00:00:00.000Z' },
          'api.secret.demo': { encrypted: 'api-cipher', updatedAt: '2026-06-11T00:00:00.000Z' }
        }
      }), 'utf8');
      await writeFile(localDbFile, 'old db', 'utf8');
      let retried = false;
      const router = createStartupRecoveryRouter({
        root: temp.root,
        getState: () => ({
          status: 'failed',
          root: temp.root,
          lastStep: 'local-database-initialize',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }),
        retryStartup: () => { retried = true; }
      });

      const session = await router.invoke(IPC_CHANNELS.authGetSession, undefined, { requestID: 'req_boot' });
      expect(session.success).toBe(false);
      if (session.success) throw new Error('startup failure should not return a session');
      expect(session.error.code).toBe('startup_failed');
      expect(session.error.details).toMatchObject({ lastStep: 'local-database-initialize' });

      await expect(readFile(secureStoreFile, 'utf8')).resolves.toContain('entries');
      const clear = await router.invoke<{ removedSession: boolean; preservedEntries: number }>(IPC_CHANNELS.startupClearSession, undefined, { requestID: 'req_clear' });
      expect(clear.success).toBe(true);
      if (!clear.success) throw new Error('clear session should succeed');
      expect(clear.data).toMatchObject({ removedSession: true, preservedEntries: 1 });
      const secureStoreAfterClear = JSON.parse(await readFile(secureStoreFile, 'utf8')) as { entries: Record<string, unknown> };
      expect(secureStoreAfterClear.entries['session.token']).toBeUndefined();
      expect(secureStoreAfterClear.entries['api.secret.demo']).toEqual({ encrypted: 'api-cipher', updatedAt: '2026-06-11T00:00:00.000Z' });

      const rebuild = await router.invoke<{ backupPath?: string }>(IPC_CHANNELS.startupRebuildLocalDatabase, undefined, { requestID: 'req_rebuild' });
      expect(rebuild.success).toBe(true);
      if (!rebuild.success) throw new Error('rebuild should succeed');
      expect(rebuild.data.backupPath).toContain('local.db.rebuild-');
      await expect(readFile(localDbFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      const retry = await router.invoke(IPC_CHANNELS.startupRetry, undefined, { requestID: 'req_retry' });
      expect(retry.success).toBe(true);
      expect(retried).toBe(true);
    } finally {
      await temp.cleanup();
    }
  });

  it('backs up corrupted startup secure-store files before clearing the session', async () => {
    const temp = await tempRoot();
    try {
      const secureStoreFile = path.join(temp.root, 'secure-store.json');
      await writeFile(secureStoreFile, '{not-json', 'utf8');
      const result = await clearStartupSession(temp.root);
      expect(result).toMatchObject({ cleared: true, resetStore: true, removedSession: false, preservedEntries: 0 });
      expect(result.backupPath).toContain('secure-store.json.session-clear-');
      expect(result.message).toContain('已备份并重置');
      await expect(readFile(secureStoreFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(result.backupPath ?? '', 'utf8')).resolves.toBe('{not-json');
    } finally {
      await temp.cleanup();
    }
  });

  it('removes malformed startup session entries while preserving valid non-session secrets', async () => {
    const temp = await tempRoot();
    try {
      const secureStoreFile = path.join(temp.root, 'secure-store.json');
      await writeFile(secureStoreFile, JSON.stringify({
        entries: {
          'session.token': { invalid: true },
          'mcp.variable.demo': { encrypted: 'mcp-cipher', updatedAt: '2026-06-11T00:00:00.000Z' }
        }
      }), 'utf8');
      const result = await clearStartupSession(temp.root);
      expect(result).toMatchObject({ cleared: true, removedSession: true, preservedEntries: 1 });
      const secureStoreAfterClear = JSON.parse(await readFile(secureStoreFile, 'utf8')) as { entries: Record<string, unknown> };
      expect(secureStoreAfterClear.entries['session.token']).toBeUndefined();
      expect(secureStoreAfterClear.entries['mcp.variable.demo']).toEqual({ encrypted: 'mcp-cipher', updatedAt: '2026-06-11T00:00:00.000Z' });
    } finally {
      await temp.cleanup();
    }
  });

  it('backs up startup secure-store files with malformed non-session entries', async () => {
    const temp = await tempRoot();
    try {
      const secureStoreFile = path.join(temp.root, 'secure-store.json');
      await writeFile(secureStoreFile, JSON.stringify({
        entries: {
          'session.token': { encrypted: 'session-cipher', updatedAt: '2026-06-11T00:00:00.000Z' },
          'api.secret.demo': { encrypted: 42, updatedAt: '2026-06-11T00:00:00.000Z' }
        }
      }), 'utf8');
      const result = await clearStartupSession(temp.root);
      expect(result).toMatchObject({ cleared: true, resetStore: true, removedSession: false, preservedEntries: 0 });
      expect(result.backupPath).toContain('secure-store.json.session-clear-');
      expect(result.message).toContain('异常密钥记录');
      await expect(readFile(secureStoreFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(result.backupPath ?? '', 'utf8')).resolves.toContain('api.secret.demo');
    } finally {
      await temp.cleanup();
    }
  });

  it('configures production assets for file-url and sandboxed preload runtime', () => {
    expect(rendererConfig.base).toBe('./');
    expect(preloadConfig.build?.lib).toMatchObject({ formats: ['cjs'] });
    expect(preloadConfig.build?.rollupOptions?.external).toContain('electron');
  });
});
