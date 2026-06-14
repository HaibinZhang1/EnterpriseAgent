import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClientLogger } from '../src/main/logging/client-logger';
import { MemorySecureStore, SafeStorageSecureStore, type SafeStorageLike } from '../src/main/security/secure-store';
import { redactForLog, redactString } from '../src/shared/redaction';
import { tempRoot } from './test-utils';

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, '')
};

describe('redaction and SecureStore', () => {
  it('redacts token, ticket, password, API key and MCP secret samples', () => {
    const redacted = redactForLog({
      Authorization: 'Bearer raw-token',
      password: 'raw-password',
      apiKey: 'raw-api-key',
      nested: 'download_ticket=ticket-123 mcp_secret=secret-456'
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toContain('raw-token');
    expect(text).not.toContain('raw-password');
    expect(text).not.toContain('raw-api-key');
    expect(text).not.toContain('ticket-123');
    expect(text).not.toContain('secret-456');
    expect(redactString('Authorization: Bearer abc.def')).toContain('[REDACTED]');
  });

  it('stores secrets through mock and safeStorage-compatible providers without leaking logs', async () => {
    const temp = await tempRoot();
    try {
      const memory = new MemorySecureStore();
      await memory.set('session.token', 'memory-token');
      expect(await memory.get('session.token')).toBe('memory-token');
      expect(await memory.getStartupSessionState()).toEqual({ hasSession: true });
      await memory.delete('session.token');
      expect(await memory.get('session.token')).toBeUndefined();
      expect(await memory.getStartupSessionState()).toEqual({ hasSession: false });

      const fileStore = new SafeStorageSecureStore(path.join(temp.root, 'secure-store.json'), fakeSafeStorage);
      await fileStore.set('session.token', 'file-token');
      await fileStore.set('auth.remembered-login', JSON.stringify({ version: 1, username: 'alice', password: 'remembered-password', autoLogin: true, updatedAt: '2026-06-14T00:00:00.000Z' }));
      expect(await fileStore.get('session.token')).toBe('file-token');
      expect(await fileStore.get('auth.remembered-login')).toContain('remembered-password');
      await expect(fileStore.getStartupSessionState()).resolves.toMatchObject({
        hasSession: true,
        hasStoredSession: true
      });
      const restartedFileStore = new SafeStorageSecureStore(path.join(temp.root, 'secure-store.json'), fakeSafeStorage);
      await expect(restartedFileStore.get('session.token')).resolves.toBeUndefined();
      await expect(restartedFileStore.getStartupSessionState()).resolves.toMatchObject({
        hasSession: false,
        hasStoredSession: true,
        message: expect.stringContaining('重新登录')
      });
      const secureStoreText = await readFile(path.join(temp.root, 'secure-store.json'), 'utf8');
      expect(secureStoreText).not.toContain('file-token');
      expect(secureStoreText).not.toContain('remembered-password');

      const logger = new ClientLogger(path.join(temp.root, 'logs', 'desktop.log'));
      await logger.info('auth token Bearer raw-token', { Authorization: 'Bearer raw-token', ticket: 'ticket-123' }, 'req_1');
      const logText = await readFile(path.join(temp.root, 'logs', 'desktop.log'), 'utf8');
      expect(logText).not.toContain('raw-token');
      expect(logText).not.toContain('ticket-123');
      expect(logText).toContain('req_1');
    } finally {
      await temp.cleanup();
    }
  });

  it('fails closed on corrupted or unavailable safe storage instead of returning an empty store', async () => {
    const temp = await tempRoot();
    try {
      const filePath = path.join(temp.root, 'secure-store.json');
      const missingStore = new SafeStorageSecureStore(filePath, fakeSafeStorage);
      await expect(missingStore.get('session.token')).resolves.toBeUndefined();

      await writeFile(filePath, '{not-json', 'utf8');
      await expect(missingStore.get('session.token')).rejects.toMatchObject({
        desktopError: { code: 'secure_store_corrupted' }
      });
      await expect(missingStore.set('session.token', 'new-token')).rejects.toMatchObject({
        desktopError: { code: 'secure_store_corrupted' }
      });
      await expect(readFile(filePath, 'utf8')).resolves.toBe('{not-json');

      await writeFile(filePath, JSON.stringify({
        entries: {
          'session.token': {
            encrypted: fakeSafeStorage.encryptString('file-token').toString('base64'),
            updatedAt: new Date().toISOString()
          }
        }
      }), 'utf8');
      const unavailableStore = new SafeStorageSecureStore(filePath, {
        ...fakeSafeStorage,
        isEncryptionAvailable: () => false
      });
      await expect(unavailableStore.getStartupSessionState()).resolves.toMatchObject({
        hasSession: false,
        hasStoredSession: true,
        message: expect.stringContaining('重新登录')
      });
      await expect(unavailableStore.get('session.token')).resolves.toBeUndefined();

      const corruptedCipherStore = new SafeStorageSecureStore(filePath, {
        ...fakeSafeStorage,
        decryptString: () => {
          throw new Error('decrypt failed');
        }
      });
      await corruptedCipherStore.set('session.token', 'file-token');
      await expect(corruptedCipherStore.get('session.token')).rejects.toMatchObject({
        desktopError: { code: 'secure_store_corrupted' }
      });
    } finally {
      await temp.cleanup();
    }
  });
});
