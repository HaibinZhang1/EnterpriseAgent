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
      await memory.delete('session.token');
      expect(await memory.get('session.token')).toBeUndefined();

      const fileStore = new SafeStorageSecureStore(path.join(temp.root, 'secure-store.json'), fakeSafeStorage);
      await fileStore.set('session.token', 'file-token');
      expect(await fileStore.get('session.token')).toBe('file-token');
      expect(await readFile(path.join(temp.root, 'secure-store.json'), 'utf8')).not.toContain('file-token');

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
      await expect(unavailableStore.get('session.token')).rejects.toMatchObject({
        desktopError: { code: 'secure_store_unavailable' }
      });

      const corruptedCipherStore = new SafeStorageSecureStore(filePath, {
        ...fakeSafeStorage,
        decryptString: () => {
          throw new Error('decrypt failed');
        }
      });
      await expect(corruptedCipherStore.get('session.token')).rejects.toMatchObject({
        desktopError: { code: 'secure_store_corrupted' }
      });
    } finally {
      await temp.cleanup();
    }
  });
});
