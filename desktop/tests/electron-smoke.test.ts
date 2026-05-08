import { describe, expect, it } from 'vitest';
import { createMainWindowOptions } from '../src/main/main-window';
import { createDesktopServices } from '../src/main/services';
import { createPreloadApi } from '../src/preload/api';
import { tempRoot } from './test-utils';

describe('Electron smoke boundaries', () => {
  it('configures renderer isolation and preload path', () => {
    const options = createMainWindowOptions('/tmp/dist/main');
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.preload).toContain('preload.js');
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
});
