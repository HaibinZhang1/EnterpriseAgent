import { describe, expect, it } from 'vitest';
import { ApiClient } from '../src/main/api/api-client';
import { ClientLogger } from '../src/main/logging/client-logger';
import { tempRoot } from './test-utils';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

describe('ApiClient', () => {
  it('propagates requestID, auth, device and client headers while redacting logs', async () => {
    const temp = await tempRoot();
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ success: true, data: { items: [] }, requestID: 'req_api' }), { status: 200 });
      };
      const logger = new ClientLogger(path.join(temp.root, 'desktop.log'));
      const client = new ApiClient({
        baseURL: 'http://server.test',
        getSessionToken: async () => 'raw-token',
        getDeviceID: async () => 'device_1',
        clientVersion: '0.1.0-m6',
        fetchImpl,
        logger
      });

      await expect(client.searchExtensions('agent', 'req_api')).resolves.toEqual({ items: [] });
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['X-Request-ID']).toBe('req_api');
      expect(headers['X-Device-ID']).toBe('device_1');
      expect(headers['X-Client-Version']).toBe('0.1.0-m6');
      expect(headers.Authorization).toBe('Bearer raw-token');
      const logText = await readFile(path.join(temp.root, 'desktop.log'), 'utf8');
      expect(logText).not.toContain('raw-token');
    } finally {
      await temp.cleanup();
    }
  });

  it('supports binary package download without logging raw ticket values', async () => {
    const temp = await tempRoot();
    try {
      const fetchImpl: typeof fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      const logger = new ClientLogger(path.join(temp.root, 'desktop.log'));
      const client = new ApiClient({ baseURL: 'http://server.test', clientVersion: '0.1.0-m6', fetchImpl, logger });
      const data = await client.downloadPackage('ticket-raw-secret', 'req_download');
      expect([...new Uint8Array(data)]).toEqual([1, 2, 3]);
      const logText = await readFile(path.join(temp.root, 'desktop.log'), 'utf8');
      expect(logText).not.toContain('ticket-raw-secret');
    } finally {
      await temp.cleanup();
    }
  });

  it('maps unauthenticated and M8 server contracts to stable errors', async () => {
    const unauthorizedFetch: typeof fetch = async () => new Response(JSON.stringify({ success: false }), { status: 401 });
    const client = new ApiClient({ baseURL: 'http://server.test', clientVersion: '0.1.0-m6', fetchImpl: unauthorizedFetch });
    await expect(client.me('req_auth')).rejects.toMatchObject({ desktopError: { code: 'unauthenticated', requestID: 'req_auth' } });
    await expect(client.registerDevice()).rejects.toMatchObject({ desktopError: { code: 'api_contract_stub' } });
    await expect(client.checkClientUpdate()).rejects.toMatchObject({ desktopError: { code: 'api_contract_stub' } });
  });

  it('preserves typed server authorization errors from M7 definition endpoints', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      success: false,
      error: { code: 'scope_restricted', message: 'scope restricted' },
      requestID: 'req_scope'
    }), { status: 403 });
    const client = new ApiClient({ baseURL: 'http://server.test', clientVersion: '0.1.0-m7', fetchImpl });

    await expect(client.getMcpDefinition('mcp.restricted', 'req_scope')).rejects.toMatchObject({
      desktopError: { code: 'scope_restricted', requestID: 'req_scope' }
    });
  });

  it('calls M7 definition and local-event sync endpoints', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      const url = String(input);
      if (url.endsWith('/api/extensions/mcp.one/mcp-definition')) {
        return new Response(JSON.stringify({ success: true, data: { extensionId: 'mcp.one', transport: 'stdio' } }), { status: 200 });
      }
      if (url.endsWith('/api/extensions/plugin.one/plugin-definition')) {
        return new Response(JSON.stringify({ success: true, data: { extensionId: 'plugin.one', installMode: 'MANUAL_DOWNLOAD' } }), { status: 200 });
      }
      if (url.endsWith('/api/local-events/sync')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            results: [{ idempotencyKey: 'event_key', status: 'ACCEPTED' }],
            serverStateHints: [{ extensionId: 'skill.one', state: 'DELISTED' }]
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    };
    const client = new ApiClient({
      baseURL: 'http://server.test',
      getDeviceID: async () => 'device_1',
      clientVersion: '0.1.0-m7',
      fetchImpl
    });

    await expect(client.getMcpDefinition('mcp.one', 'req_mcp')).resolves.toMatchObject({ extensionId: 'mcp.one' });
    await expect(client.getPluginDefinition('plugin.one', 'req_plugin')).resolves.toMatchObject({ extensionId: 'plugin.one' });
    const sync = await client.syncLocalEvents([{
      id: 'event_1',
      idempotencyKey: 'event_key',
      deviceID: 'device_1',
      extensionID: 'skill.one',
      version: '1.0.0',
      eventType: 'skill.enabled',
      result: 'success',
      payload: { note: 'enabled' },
      status: 'pending',
      attemptCount: 0,
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z'
    }], 'req_sync');

    expect(calls.map((call) => call.url)).toEqual([
      'http://server.test/api/extensions/mcp.one/mcp-definition',
      'http://server.test/api/extensions/plugin.one/plugin-definition',
      'http://server.test/api/local-events/sync'
    ]);
    expect(JSON.parse(calls[2].init.body as string)).toMatchObject({
      deviceId: 'device_1',
      events: [{ idempotencyKey: 'event_key', extensionId: 'skill.one', type: 'skill.enabled' }]
    });
    expect(sync.acknowledgements).toEqual([{ idempotencyKey: 'event_key', result: 'accepted' }]);
    expect(sync.serverStateHints).toEqual([{ extensionId: 'skill.one', state: 'DELISTED' }]);
  });
});
