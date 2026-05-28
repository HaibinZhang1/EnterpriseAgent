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

    ipcMain.handle('enterprise-agent:invoke', (_event, request) => ({
      success: true,
      requestID: request.requestID,
      data: { deviceID: 'device_runtime' }
    }));

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

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
