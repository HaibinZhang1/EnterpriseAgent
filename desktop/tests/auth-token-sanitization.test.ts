import { describe, expect, it } from 'vitest';
import { createDesktopServices } from '../src/main/services';
import { IPC_CHANNELS } from '../src/main/ipc/channels';
import { tempRoot } from './test-utils';

describe('auth IPC token sanitization', () => {
  it('stores login token in SecureStore but never returns it to renderer IPC', async () => {
    const temp = await tempRoot();
    try {
      const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
        success: true,
        data: { token: 'raw-login-token', user: { id: 'user_1' }, permissions: ['catalog.read'] },
        requestID: 'req_login'
      }), { status: 200 });
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const result = await services.router.invoke(IPC_CHANNELS.authLogin, { username: 'u', password: 'p' }, { requestID: 'req_login' });
      expect(result.success).toBe(true);
      expect(JSON.stringify(result)).not.toContain('raw-login-token');
      expect(await services.secureStore.get('session.token')).toBe('raw-login-token');
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
