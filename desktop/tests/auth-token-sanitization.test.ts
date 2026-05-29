import { describe, expect, it } from 'vitest';
import { createDesktopServices } from '../src/main/services';
import { IPC_CHANNELS } from '../src/main/ipc/channels';
import { tempRoot } from './test-utils';

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

      const result = await services.router.invoke(IPC_CHANNELS.authChangePassword, { oldPassword: 'Old#123456', newPassword: 'New#123456' }, { requestID: 'req_password' });

      expect(result.success).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://localhost:8080/api/auth/change-password');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer raw-login-token');
      expect(await services.secureStore.get('session.token')).toBeUndefined();
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
