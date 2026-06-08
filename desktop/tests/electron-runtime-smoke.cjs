const { app, BrowserWindow, ipcMain } = require('electron');
const { writeFile, mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'eah-electron-runtime-'));
  const preloadPath = path.join(tempRoot, 'preload.cjs');
  const htmlPath = path.join(tempRoot, 'index.html');
  const timeout = setTimeout(() => {
    console.error('electron runtime isolation smoke timed out');
    app.exit(1);
  }, 15_000);

  try {
    await writeFile(preloadPath, `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('enterpriseAgent', {
  device: {
    getInfo: (requestID) => ipcRenderer.invoke('enterprise-agent:invoke', { channel: 'device.getInfo', requestID })
  }
});
`, 'utf8');
    await writeFile(htmlPath, '<!doctype html><html><body><main id="root">runtime smoke</main></body></html>', 'utf8');

    const localCalls = [];
    ipcMain.handle('enterprise-agent:invoke', (_event, request) => {
      localCalls.push(request);
      return {
        success: true,
        requestID: request.requestID,
        data: responseForChannel(request.channel, request.payload)
      };
    });

    await app.whenReady();
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    await window.loadURL(pathToFileURL(htmlPath).toString());
    const result = await window.webContents.executeJavaScript(`(async () => ({
      hasApi: Boolean(window.enterpriseAgent && window.enterpriseAgent.device),
      hasRawIpc: Boolean(window.ipcRenderer),
      requireType: typeof window.require,
      processType: typeof window.process,
      fsType: typeof window.fs,
      response: await window.enterpriseAgent.device.getInfo('req_runtime')
    }))()`);
    const failures = [];
    if (!result.hasApi) failures.push('preload API missing');
    if (result.hasRawIpc) failures.push('raw ipcRenderer exposed');
    if (result.requireType !== 'undefined') failures.push(`require exposed: ${result.requireType}`);
    if (result.processType !== 'undefined') failures.push(`process exposed: ${result.processType}`);
    if (result.fsType !== 'undefined') failures.push(`fs exposed: ${result.fsType}`);
    if (!result.response?.success || result.response.requestID !== 'req_runtime') failures.push('safe IPC call failed');
    if (failures.length > 0) {
      console.error(failures.join('\n'));
      app.exit(1);
      return;
    }
    window.destroy();

    const appWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'dist', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    await appWindow.loadURL(pathToFileURL(path.join(__dirname, '..', 'dist', 'renderer', 'index.html')).toString());
    const appResult = await appWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      setTimeout(() => resolve({
        hasApi: Boolean(window.enterpriseAgent && window.enterpriseAgent.auth && window.enterpriseAgent.device),
        hasRawIpc: Boolean(window.ipcRenderer),
        text: document.body.innerText,
        childCount: document.getElementById('root')?.children.length ?? 0
      }), 250);
    })`);
    if (!appResult.hasApi) failures.push('built preload API missing');
    if (appResult.hasRawIpc) failures.push('built preload exposed raw ipcRenderer');
    if (!appResult.text.includes('Enterprise Agent Hub')) failures.push('built renderer did not render app text');
    if (appResult.childCount === 0) failures.push('built renderer root is empty');
    const interactionResult = await appWindow.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 80; i += 1) {
          const result = predicate();
          if (result) return result;
          await sleep(50);
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const allButtons = () => Array.from(document.querySelectorAll('button'));
      const byText = (text) => allButtons().find((button) => (button.textContent || '').includes(text));
      const byTestId = (testId) => document.querySelector('[data-testid="' + testId + '"]');
      const clickElement = async (element, label) => {
        if (!element) throw new Error('Missing button: ' + label);
        element.click();
        await sleep(80);
      };
      const clickText = async (text) => clickElement(byText(text), text);
      const clickTestId = async (testId) => clickElement(byTestId(testId), testId);

      await waitFor(() => document.body.innerText.includes('Agent 工作台'), 'agent home');
      await clickText('本地');
      await waitFor(() => byTestId('local-nav-skill'), 'local skill nav');

      for (const tab of ['mcp', 'plugin', 'project', 'event', 'skill']) {
        await clickTestId('local-nav-' + tab);
        await waitFor(() => byTestId('local-nav-' + tab)?.getAttribute('aria-pressed') === 'true', 'active ' + tab);
      }

      const filters = ['全部', '已安装', '已启用', '已接入', '有更新', '异常', '授权收缩', '安全风险', '全部'];
      for (const filter of filters) {
        await clickTestId('local-filter-' + filter);
        await waitFor(() => byTestId('local-filter-' + filter)?.getAttribute('aria-pressed') === 'true', 'filter ' + filter);
      }

      await clickTestId('local-rescan');
      await waitFor(() => byTestId('local-scan-summary')?.textContent.includes('Skill 1'), 'scan summary');

      await waitFor(() => byTestId('local-expand-skill-one'), 'skill expand');
      await clickTestId('local-expand-skill-one');
      await waitFor(() => byTestId('local-expand-skill-one')?.getAttribute('aria-expanded') === 'true', 'skill expanded');
      if (!document.body.innerText.includes('Skill 激活目标')) throw new Error('expanded skill target missing');

      await clickTestId('local-detail-skill-one');
      await waitFor(() => document.body.innerText.includes('启用 Skill'), 'skill detail drawer');
      await clickElement(document.querySelector('aside[role="dialog"] button[aria-label="关闭"]'), 'close detail');

      await clickTestId('local-cleanup-skill-one');
      await waitFor(() => document.body.innerText.includes('本地清理确认'), 'cleanup modal');
      await clickText('取消');

      await clickTestId('local-cleanup-target-skill-one-0');
      await waitFor(() => document.body.innerText.includes('本地清理确认'), 'target cleanup modal');
      await clickText('确认清理');
      await waitFor(() => document.body.innerText.includes('清理结果：success'), 'cleanup result');

      return {
        text: document.body.innerText,
        scanSummary: byTestId('local-scan-summary')?.textContent,
        skillExpanded: byTestId('local-expand-skill-one')?.getAttribute('aria-expanded')
      };
    })()`);
    if (!interactionResult.text.includes('查看详情')) failures.push('local skill detail action missing');
    if (!interactionResult.text.includes('清理结果：success')) failures.push('local cleanup confirmation did not report success');
    if (!interactionResult.scanSummary?.includes('Skill 1')) failures.push('local scan summary missing Skill count');
    if (!localCalls.some((request) => request.channel === 'local.scanInventory')) failures.push('local rescan did not invoke IPC');
    if (!localCalls.some((request) => request.channel === 'extension.getDetail' && request.payload?.extensionID === 'skill-one')) failures.push('local detail did not invoke extension detail IPC');
    if (!localCalls.some((request) => request.channel === 'local.cleanup')) failures.push('local cleanup did not invoke IPC');
    if (failures.length > 0) {
      console.error(failures.join('\n'));
      app.exit(1);
      return;
    }
    console.log('electron runtime isolation smoke passed');
    appWindow.destroy();
    app.quit();
  } finally {
    clearTimeout(timeout);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function responseForChannel(channel, payload) {
  switch (channel) {
    case 'auth.getSession':
      return { hasSession: true };
    case 'auth.me':
      return { username: 'alice', displayName: 'Alice' };
    case 'device.getInfo':
      return { deviceID: 'device_runtime', clientVersion: '0.1.0-m6', osVersion: 'macOS', arch: 'arm64' };
    case 'local.getOfflineState':
      return { online: true, checkedAt: '2026-06-06T07:00:00Z' };
    case 'settings.getLocalConfig':
      return { theme: 'glass-dark', notificationsEnabled: true };
    case 'clientUpdate.getPending':
      return undefined;
    case 'catalog.home':
      return { skills: [], mcps: [], plugins: [], hot: [], stars: [], downloads: [] };
    case 'notifications.list':
      return [];
    case 'local.syncPending':
      return { synced: 0 };
    case 'local.scanInventory':
      return { scannedAt: '2026-06-06T07:00:00Z', discovered: { skills: 1, mcpConfigs: 1, plugins: 1, tools: 1, projects: 1, total: 5 } };
    case 'local.listPendingEvents':
      return [{ id: 'event-one', eventType: 'SKILL_ENABLE', extensionID: 'skill-one', status: 'queued' }];
    case 'local.listLifecycle':
      return localLifecycle();
    case 'extension.getDetail':
      return extensionDetail(payload?.extensionID);
    case 'extension.getVersions':
      return [{ version: '1.0.0', status: 'PUBLISHED', createdAt: '2026-06-06T07:00:00Z' }];
    case 'local.cleanup':
      return { plan: { operation: 'SKILL_UNINSTALL', summary: { title: 'Local cleanup' } }, result: { status: 'success', steps: [] } };
    default:
      throw new Error(`Unhandled IPC channel in runtime smoke: ${channel}`);
  }
}

function localLifecycle() {
  return {
    extensions: [
      { extensionId: 'skill-one', name: 'Skill One', summary: 'A local skill for smoke testing.', version: '1.0.0', status: 'scope_reduced', updatedAt: '2026-06-06T07:00:00Z', metadata: { message: '授权范围已收缩' } },
      { extensionId: 'mcp-one', name: 'MCP One', summary: 'A managed MCP config.', version: '1.0.0', status: 'connected', updatedAt: '2026-06-06T07:00:00Z' },
      { extensionId: 'plugin-one', name: 'Plugin One', summary: 'A managed plugin.', version: '1.0.0', status: 'installed', updatedAt: '2026-06-06T07:00:00Z' }
    ],
    versions: [
      { extensionId: 'skill-one', version: '1.0.0' },
      { extensionId: 'mcp-one', version: '1.0.0' },
      { extensionId: 'plugin-one', version: '1.0.0' }
    ],
    targets: [
      { id: 'target-one', extensionId: 'skill-one', target: '/Users/alice/.codex/skills/skill-one', status: 'enabled', metadata: { managed: true, kind: 'skill' } }
    ],
    mcpInstallations: [
      { id: 'mcp-target-one', extensionId: 'mcp-one', configPath: '/Users/alice/.codex/mcp/mcp-one.json', status: 'connected' }
    ],
    pluginInstallations: [
      { id: 'plugin-target-one', extensionId: 'plugin-one', target: '/Users/alice/.codex/plugins/plugin-one', status: 'installed' }
    ],
    tools: [{ id: 'tool-one', name: 'Codex', status: 'detected' }],
    projects: [{ id: 'project-one', name: 'EnterpriseAgent', path: '/Users/alice/EnterpriseAgent' }]
  };
}

function extensionDetail(extensionID) {
  const kind = extensionID === 'mcp-one' ? 'mcp' : extensionID === 'plugin-one' ? 'plugin' : 'skill';
  const name = extensionID === 'mcp-one' ? 'MCP One' : extensionID === 'plugin-one' ? 'Plugin One' : 'Skill One';
  return { extensionId: extensionID, extensionType: kind, name, summary: name + ' detail', version: '1.0.0', status: 'PUBLISHED', authorized: true };
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
