import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopServices } from '../src/main/services';
import { IPC_CHANNELS } from '../src/main/ipc/channels';
import { tempRoot } from './test-utils';

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')
};

describe('auth IPC token sanitization', () => {
  it('stores login token in SecureStore but never returns it to renderer IPC', async () => {
    const temp = await tempRoot();
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({
          success: true,
          data: { token: 'raw-login-token', user: { id: 'user_1', mustChangePassword: false }, permissions: ['catalog.read'] },
          requestID: 'req_login'
        }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const result = await services.router.invoke(IPC_CHANNELS.authLogin, { username: 'u', password: 'p' }, { requestID: 'req_login' });
      expect(result.success).toBe(true);
      expect(JSON.stringify(result)).not.toContain('raw-login-token');
      if (!result.success) throw new Error('login should succeed');
      expect((result.data as { user?: { mustChangePassword?: boolean } }).user?.mustChangePassword).toBe(false);
      expect(await services.secureStore.get('session.token')).toBe('raw-login-token');
      expect(calls.map((call) => call.url)).toEqual([
        'http://localhost:8080/api/auth/login',
        'http://localhost:8080/api/client-devices/register'
      ]);
      expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
        phone: 'u',
        password: 'p',
        clientType: 'DESKTOP',
        deviceId: expect.stringMatching(/^device_/),
        clientVersion: '0.1.0-m6'
      });
      expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer raw-login-token');
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('clears the stored token after a successful password change', async () => {
    const temp = await tempRoot();
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ success: true, data: null, requestID: 'req_password' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      await services.secureStore.set('session.token', 'raw-login-token');
      await services.secureStore.set('auth.remembered-login', JSON.stringify({ version: 1, username: 'u', password: 'old-password', autoLogin: true, updatedAt: '2026-06-14T00:00:00.000Z' }));

      const result = await services.router.invoke(IPC_CHANNELS.authChangePassword, { oldPassword: 'Old#123456', newPassword: 'New#123456' }, { requestID: 'req_password' });

      expect(result.success).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://localhost:8080/api/auth/change-password');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer raw-login-token');
      expect(await services.secureStore.get('session.token')).toBeUndefined();
      expect(await services.secureStore.get('auth.remembered-login')).toBeUndefined();
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('does not attach a skipped stored session token before explicit login', async () => {
    const temp = await tempRoot();
    try {
      await mkdir(temp.root, { recursive: true });
      await writeFile(path.join(temp.root, 'secure-store.json'), `${JSON.stringify({
        entries: {
          'session.token': {
            encrypted: fakeSafeStorage.encryptString('stored-token').toString('base64'),
            updatedAt: '2026-06-14T00:00:00.000Z'
          }
        }
      })}\n`, 'utf8');
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ success: true, data: {}, requestID: 'req_catalog' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl, safeStorage: fakeSafeStorage });

      const session = await services.router.invoke(IPC_CHANNELS.authGetSession, undefined, { requestID: 'req_session' });
      expect(session.success).toBe(true);
      if (!session.success) throw new Error('session lookup should succeed');
      expect(session.data).toMatchObject({ hasSession: false, hasStoredSession: true });

      await services.apiClient.communityHome('req_catalog');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('sends logout with the current runtime token before clearing it locally', async () => {
    const temp = await tempRoot();
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ success: true, data: null, requestID: 'req_logout' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl, safeStorage: fakeSafeStorage });
      await services.secureStore.set('session.token', 'raw-login-token');

      const result = await services.router.invoke(IPC_CHANNELS.authLogout, undefined, { requestID: 'req_logout' });

      expect(result.success).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://localhost:8080/api/auth/logout');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer raw-login-token');
      expect(await services.secureStore.get('session.token')).toBeUndefined();
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('stores remembered desktop login only in SecureStore and auto-login never returns secrets', async () => {
    const temp = await tempRoot();
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      let loginCount = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        if (String(input).endsWith('/api/auth/login')) {
          loginCount += 1;
          return new Response(JSON.stringify({
            success: true,
            data: { token: `raw-login-token-${loginCount}`, user: { id: 'user_1', username: 'u', mustChangePassword: false } },
            requestID: 'req_login'
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, data: {}, requestID: 'req_register' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl, safeStorage: fakeSafeStorage });

      const login = await services.router.invoke(IPC_CHANNELS.authLogin, { username: 'u', password: 'remember-me', rememberPassword: true }, { requestID: 'req_login' });
      expect(login.success).toBe(true);
      expect(JSON.stringify(login)).not.toContain('raw-login-token-1');
      expect(JSON.stringify(login)).not.toContain('remember-me');

      const remembered = await services.router.invoke(IPC_CHANNELS.authGetRememberedLogin, undefined, { requestID: 'req_remembered' });
      expect(remembered).toMatchObject({ success: true, data: { remembered: true, username: 'u', autoLogin: true } });
      expect(JSON.stringify(remembered)).not.toContain('remember-me');
      expect(await readFile(path.join(temp.root, 'secure-store.json'), 'utf8')).not.toContain('remember-me');

      const autoLogin = await services.router.invoke(IPC_CHANNELS.authAutoLogin, undefined, { requestID: 'req_auto_login' });
      expect(autoLogin.success).toBe(true);
      expect(JSON.stringify(autoLogin)).not.toContain('raw-login-token-2');
      expect(JSON.stringify(autoLogin)).not.toContain('remember-me');
      expect(JSON.parse(calls.filter((call) => call.url.endsWith('/api/auth/login')).at(-1)?.init.body as string)).toMatchObject({
        phone: 'u',
        password: 'remember-me',
        clientType: 'DESKTOP'
      });

      const cleared = await services.router.invoke(IPC_CHANNELS.authClearRememberedLogin, undefined, { requestID: 'req_clear_remembered' });
      expect(cleared).toMatchObject({ success: true, data: { remembered: false, autoLogin: false } });
      expect(await services.secureStore.get('auth.remembered-login')).toBeUndefined();
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
