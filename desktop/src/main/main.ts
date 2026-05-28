import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerElectronIpc } from './ipc/ipc-router';
import { createMainWindowOptions } from './main-window';
import { createDesktopServices } from './services';

async function createWindow(): Promise<void> {
  const services = await createDesktopServices({ app, safeStorage });
  registerElectronIpc(ipcMain, services.router);
  services.deviceHeartbeatScheduler.start();
  app.once('before-quit', () => {
    services.deviceHeartbeatScheduler.stop();
  });
  void services.clientUpdateService.reportStartupVersion().catch((error) => {
    void services.logger.warn('client_update.startup_report_failed', error);
  });

  const window = new BrowserWindow(createMainWindowOptions(__dirname));
  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadURL(pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).toString());
  }
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Failed to start Enterprise Agent Hub desktop', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
