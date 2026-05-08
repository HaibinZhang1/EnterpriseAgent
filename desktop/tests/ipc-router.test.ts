import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createDesktopServices } from '../src/main/services';
import { IPC_CHANNELS } from '../src/main/ipc/channels';
import { createPreloadApi } from '../src/preload/api';
import { tempRoot } from './test-utils';

describe('IPC router and preload API', () => {
  it('returns typed success and failure envelopes with requestID', async () => {
    const temp = await tempRoot();
    try {
      const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ success: true, data: { ok: true }, requestID: 'req_1' }), { status: 200 });
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const deviceResult = await services.router.invoke(IPC_CHANNELS.deviceGetInfo, undefined, { requestID: 'req_device' });
      expect(deviceResult).toMatchObject({ success: true, requestID: 'req_device' });

      const invalid = await services.router.invoke(IPC_CHANNELS.extensionGetDetail, {}, { requestID: 'req_invalid' });
      expect(invalid).toMatchObject({ success: false, requestID: 'req_invalid', error: { code: 'validation_failed' } });

      const missingTarget = await services.router.invoke(IPC_CHANNELS.extensionInstall, { extensionID: 'ext' }, { requestID: 'req_install_missing' });
      expect(missingTarget).toMatchObject({ success: false, requestID: 'req_install_missing', error: { code: 'validation_failed' } });

      const installPlan = await services.router.invoke(IPC_CHANNELS.extensionInstall, { extensionID: 'ext', targetPath: path.join(temp.root, 'skills/ext') }, { requestID: 'req_install' });
      expect(installPlan).toMatchObject({ success: true, requestID: 'req_install', data: { operation: 'SKILL_ENABLE' } });

      const unknown = await services.router.invoke('raw.ipcRenderer', {}, { requestID: 'req_unknown' });
      expect(unknown).toMatchObject({ success: false, error: { code: 'unknown_ipc_channel' } });
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('preload exposes only whitelisted grouped methods, never raw ipcRenderer or Node objects', () => {
    const api = createPreloadApi(async <T>(channel: any, _payload?: unknown, requestID?: string) => ({ success: true, data: channel as T, requestID: requestID ?? 'req' }));
    expect(Object.keys(api).sort()).toEqual(['auth', 'catalog', 'device', 'extension', 'local', 'logs', 'settings']);
    expect(JSON.stringify(api)).not.toContain('ipcRenderer');
    expect('fs' in api).toBe(false);
    expect('process' in api).toBe(false);
  });
});
