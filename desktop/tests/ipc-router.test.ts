import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
      expect(installPlan).toMatchObject({ success: true, requestID: 'req_install', data: { plan: { operation: 'SKILL_ENABLE' }, result: { status: 'dry_run' } } });

      const cleanupPlan = await services.router.invoke(IPC_CHANNELS.localCleanup, { extensionID: 'ext', target: path.join(temp.root, 'skills'), localKind: 'skill', dryRun: true }, { requestID: 'req_cleanup' });
      expect(cleanupPlan).toMatchObject({ success: true, requestID: 'req_cleanup', data: { plan: { operation: 'SKILL_UNINSTALL' }, result: { status: 'dry_run' } } });

      const pendingUpdate = await services.router.invoke(IPC_CHANNELS.clientUpdateGetPending, undefined, { requestID: 'req_update_pending' });
      expect(pendingUpdate).toMatchObject({ success: true, requestID: 'req_update_pending' });

      const scan = await services.router.invoke(IPC_CHANNELS.localScanInventory, undefined, { requestID: 'req_scan' });
      expect(scan).toMatchObject({ success: true, requestID: 'req_scan', data: { discovered: expect.any(Object) } });
      if (!scan.success) throw new Error('local scan should succeed');
      expect(Number((scan.data as { discovered?: { total?: number } }).discovered?.total ?? 0)).toBeGreaterThanOrEqual(0);

      const unknown = await services.router.invoke('raw.ipcRenderer', {}, { requestID: 'req_unknown' });
      expect(unknown).toMatchObject({ success: false, error: { code: 'unknown_ipc_channel' } });
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('preload exposes only whitelisted grouped methods, never raw ipcRenderer or Node objects', () => {
    const api = createPreloadApi(async <T>(channel: any, _payload?: unknown, requestID?: string) => ({ success: true, data: channel as T, requestID: requestID ?? 'req' }));
    expect(Object.keys(api).sort()).toEqual(['auth', 'catalog', 'clientUpdate', 'device', 'extension', 'local', 'logs', 'mcp', 'notifications', 'plugin', 'publish', 'settings']);
    expect(Object.keys(api.clientUpdate).sort()).toEqual(['cancel', 'check', 'confirmDownload', 'confirmInstall', 'getPending']);
    expect(Object.keys(api.local).sort()).toEqual(['cleanup', 'enqueueEvent', 'getOfflineState', 'getStatus', 'listLifecycle', 'listPendingEvents', 'scanInventory', 'syncPending']);
    expect(JSON.stringify(api)).not.toContain('ipcRenderer');
    expect('fs' in api).toBe(false);
    expect('process' in api).toBe(false);
  });

  it('applies saved baseURL settings to the live ApiClient instance', async () => {
    const temp = await tempRoot();
    const calls: string[] = [];
    try {
      const fetchImpl: typeof fetch = async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const saved = await services.router.invoke(IPC_CHANNELS.settingsSaveLocalConfig, { baseURL: 'http://changed.test/' }, { requestID: 'req_save_url' });
      expect(saved).toMatchObject({ success: true, data: { baseURL: 'http://changed.test/' } });
      await services.apiClient.health('req_health_changed');
      expect(calls.at(-1)).toBe('http://changed.test/api/health');
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('normalizes server definition field names before local MCP and Plugin actions', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/fail') {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP server address is unavailable');
    const healthUrl = `http://127.0.0.1:${address.port}/health`;

    const temp = await tempRoot();
    try {
      const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/api/extensions/mcp-contract/mcp-definition')) {
          return new Response(JSON.stringify({ success: true, data: { extensionId: 'mcp-contract', version: '1.0.0', configTemplate: {}, connectionTest: { type: 'HTTP_HEALTH', target: healthUrl } } }), { status: 200 });
        }
        if (url.endsWith('/api/extensions/mcp-fail/mcp-definition')) {
          return new Response(JSON.stringify({ success: true, data: { extensionId: 'mcp-fail', version: '1.0.0', configTemplate: {}, connectionTest: { type: 'HTTP_HEALTH', target: `${healthUrl.replace('/health', '')}/fail` } } }), { status: 200 });
        }
        if (url.endsWith('/api/extensions/plugin-contract/plugin-definition')) {
          return new Response(JSON.stringify({ success: true, data: { extensionId: 'plugin-contract', version: '1.0.0', installMode: 'MANUAL_DOWNLOAD', manifest: {}, manualInstallDoc: 'Read the managed installation guide.', externalDownload: 'https://plugins.example/download' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, data: {}, requestID: 'req' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const sync = await services.router.invoke(IPC_CHANNELS.localSyncPending, { online: true, previousOnline: false, reason: 'startup' }, { requestID: 'req_sync' });
      expect(sync).toMatchObject({ success: true, data: { skipped: true, skipReason: 'no_pending_events' } });

      const mcp = await services.router.invoke(IPC_CHANNELS.mcpConnectionTest, { extensionID: 'mcp-contract' }, { requestID: 'req_mcp_contract' });
      expect(mcp).toMatchObject({ success: true, data: { status: 'reachable' } });

      const mcpConfigPath = path.join(temp.root, 'mcp.json');
      const mcpConfig = await services.router.invoke(IPC_CHANNELS.mcpConfigure, { extensionID: 'mcp-contract', targetConfigPath: mcpConfigPath, dryRun: false }, { requestID: 'req_mcp_config' });
      expect(mcpConfig).toMatchObject({ success: true, data: { plan: { operation: 'MCP_CONFIG_WRITE' }, connectionTest: { status: 'reachable' }, result: { status: 'success' } } });
      expect(await readFile(mcpConfigPath, 'utf8')).toContain('enterpriseAgentHubManaged');

      const mcpFailConfigPath = path.join(temp.root, 'mcp-fail.json');
      const mcpFailConfig = await services.router.invoke(IPC_CHANNELS.mcpConfigure, { extensionID: 'mcp-fail', targetConfigPath: mcpFailConfigPath, dryRun: false }, { requestID: 'req_mcp_config_fail' });
      expect(mcpFailConfig).toMatchObject({ success: true, data: { connectionTest: { status: 'unreachable' }, rollbackPlan: { operation: 'MCP_CONFIG_UNINSTALL' }, rollbackResult: { status: 'success' } } });
      expect(JSON.parse(await readFile(mcpFailConfigPath, 'utf8'))).toMatchObject({ enterpriseAgentHubManaged: {} });

      const plugin = await services.router.invoke(IPC_CHANNELS.pluginPrepare, { extensionID: 'plugin-contract', targetPath: path.join(temp.root, 'plugins'), dryRun: true }, { requestID: 'req_plugin_contract' });
      expect(plugin).toMatchObject({ success: true, data: { plan: { operation: 'PLUGIN_MANUAL_CONTROLLED_DOWNLOAD' }, result: { status: 'dry_run' } } });
      expect(JSON.stringify(plugin)).toContain('Read the managed installation guide.');
      await services.db.close();
    } finally {
      server.close();
      await temp.cleanup();
    }
  });

  it('uses download tickets, package bytes, hash verification, and Central Store before enabling Skills', async () => {
    const temp = await tempRoot();
    const packageBytes = new TextEncoder().encode('skill package bytes');
    const sha256 = createHash('sha256').update(packageBytes).digest('hex');
    const calls: string[] = [];
    try {
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/api/extensions/skill-contract')) {
          return new Response(JSON.stringify({ success: true, data: { extensionId: 'skill-contract', version: '1.0.0', name: 'Skill Contract', packageSha256: sha256 } }), { status: 200 });
        }
        if (url.endsWith('/api/download-tickets')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ extensionID: 'skill-contract', extensionId: 'skill-contract', version: '1.0.0', purpose: 'INSTALL', objectType: 'EXTENSION_PACKAGE' });
          expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('download:skill-contract:1.0.0:INSTALL');
          return new Response(JSON.stringify({ success: true, data: { ticket: 'ticket-skill', fileName: 'skill-contract.pkg', sha256 } }), { status: 200 });
        }
        if (url.endsWith('/api/download-tickets/ticket-skill/download')) {
          return new Response(packageBytes, { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, data: {}, requestID: 'req' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const targetPath = path.join(temp.root, 'targets');
      const install = await services.router.invoke(
        IPC_CHANNELS.extensionInstall,
        { extensionID: 'skill-contract', version: '1.0.0', targetPath, dryRun: false },
        { requestID: 'req_skill_full' }
      );

      expect(install).toMatchObject({
        success: true,
        data: {
          installPlan: { operation: 'SKILL_INSTALL' },
          installResult: { status: 'success' },
          plan: { operation: 'SKILL_ENABLE' },
          result: { status: 'success' }
        }
      });
      expect(calls).toEqual(expect.arrayContaining([
        'GET http://localhost:8080/api/extensions/skill-contract',
        'POST http://localhost:8080/api/download-tickets',
        'GET http://localhost:8080/api/download-tickets/ticket-skill/download'
      ]));
      expect(await readFile(path.join(temp.root, 'central-store', 'skills', 'skill-contract', '1.0.0', 'package'), 'utf8')).toBe('skill package bytes');
      expect(services.eventQueue.listPending().map((event) => event.eventType)).toEqual(expect.arrayContaining(['SKILL_INSTALL', 'SKILL_ENABLE']));
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('uses controlled downloads for manual Plugin packages without auto-installing them', async () => {
    const temp = await tempRoot();
    const packageBytes = new TextEncoder().encode('plugin package bytes');
    const sha256 = createHash('sha256').update(packageBytes).digest('hex');
    try {
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/extensions/plugin-manual/plugin-definition')) {
          return new Response(JSON.stringify({
            success: true,
            data: {
              extensionId: 'plugin-manual',
              version: '2.0.0',
              installMode: 'MANUAL_DOWNLOAD',
              packageSha256: sha256,
              manualInstallDoc: 'Install from the tool marketplace after review.'
            }
          }), { status: 200 });
        }
        if (url.endsWith('/api/download-tickets')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ extensionID: 'plugin-manual', purpose: 'MANUAL_DOWNLOAD', objectType: 'EXTERNAL_PLUGIN_FILE' });
          return new Response(JSON.stringify({ success: true, data: { ticket: 'ticket-plugin', fileName: 'plugin.pkg', sha256 } }), { status: 200 });
        }
        if (url.endsWith('/api/download-tickets/ticket-plugin/download')) {
          return new Response(packageBytes, { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, data: {}, requestID: 'req' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const targetPath = path.join(temp.root, 'plugins');
      const plugin = await services.router.invoke(
        IPC_CHANNELS.pluginPrepare,
        { extensionID: 'plugin-manual', targetPath, installMode: 'MANUAL_DOWNLOAD', dryRun: false },
        { requestID: 'req_plugin_download' }
      );

      expect(plugin).toMatchObject({ success: true, data: { plan: { operation: 'PLUGIN_MANUAL_CONTROLLED_DOWNLOAD' }, result: { status: 'success' } } });
      expect(await readFile(path.join(targetPath, 'plugin-manual.manual.json'), 'utf8')).toContain('"controlledDownload":true');
      expect(services.eventQueue.listPending().map((event) => event.eventType)).toContain('PLUGIN_MANUAL_CONTROLLED_DOWNLOAD');
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('uses stored MCP schema to surface update variable changes through IPC', async () => {
    const temp = await tempRoot();
    let mcpDefinitionVersion = 0;
    try {
      const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/api/extensions/mcp-diff/mcp-definition')) {
          mcpDefinitionVersion += 1;
          const variablesSchema = mcpDefinitionVersion === 1
            ? [{ name: 'endpoint' }, { name: 'removedFlag' }]
            : [{ name: 'endpoint' }, { name: 'newFlag' }];
          return new Response(JSON.stringify({ success: true, data: { extensionId: 'mcp-diff', version: `1.0.${mcpDefinitionVersion}`, configTemplate: {}, variablesSchema } }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, data: {}, requestID: 'req' }), { status: 200 });
      };
      const services = await createDesktopServices({ rootOverride: temp.root, fetchImpl });
      const targetConfigPath = path.join(temp.root, 'mcp.json');
      const first = await services.router.invoke(
        IPC_CHANNELS.mcpConfigure,
        { extensionID: 'mcp-diff', targetConfigPath, variables: { endpoint: 'http://internal', removedFlag: 'old' }, dryRun: false },
        { requestID: 'req_mcp_first' }
      );
      expect(first).toMatchObject({ success: true, data: { plan: { operation: 'MCP_CONFIG_WRITE' }, result: { status: 'success' } } });

      const second = await services.router.invoke(
        IPC_CHANNELS.mcpConfigure,
        { extensionID: 'mcp-diff', targetConfigPath, variables: { endpoint: 'http://internal', newFlag: 'yes' }, dryRun: true },
        { requestID: 'req_mcp_second' }
      );
      expect(second).toMatchObject({ success: true, data: { plan: { operation: 'MCP_CONFIG_UPDATE' } } });
      expect(JSON.stringify(second)).toContain('MCP variables added: newFlag');
      expect(JSON.stringify(second)).toContain('MCP variables removed: removedFlag');

      const update = await services.router.invoke(
        IPC_CHANNELS.mcpConfigure,
        { extensionID: 'mcp-diff', targetConfigPath, variables: { endpoint: 'http://internal', newFlag: 'yes' }, dryRun: false },
        { requestID: 'req_mcp_update' }
      );
      expect(update).toMatchObject({ success: true, data: { plan: { operation: 'MCP_CONFIG_UPDATE' }, result: { status: 'success' } } });

      const uninstall = await services.router.invoke(
        IPC_CHANNELS.localCleanup,
        { extensionID: 'mcp-diff', target: targetConfigPath, localKind: 'mcp', dryRun: false },
        { requestID: 'req_mcp_uninstall' }
      );
      expect(uninstall).toMatchObject({ success: true, data: { plan: { operation: 'MCP_CONFIG_UNINSTALL' }, result: { status: 'success' } } });
      expect(services.eventQueue.listPending().map((event) => event.eventType)).toEqual(
        expect.arrayContaining(['MCP_CONFIG_WRITE', 'MCP_CONFIG_UPDATE', 'MCP_CONFIG_UNINSTALL'])
      );
      await services.db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
