import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDefaultAppRoot } from './config/app-paths';
import { IPC_CHANNELS } from './ipc/channels';
import { registerElectronIpc } from './ipc/ipc-router';
import { createManagedMainWindow, MainWindowRegistry } from './main-window';
import { createDesktopServices, type DesktopServices, type StartupStepEvent } from './services';
import { createStartupRecoveryRouter, type StartupRuntimeState } from './startup-recovery';
import { makeDesktopError, toDesktopError } from '../shared/errors';

const mainWindowRegistry = new MainWindowRegistry<BrowserWindow>();
const startupTimeoutMs = Number(process.env.EAH_DESKTOP_STARTUP_TIMEOUT_MS ?? '8000');
let startupAttempt = 0;
let activeServices: DesktopServices | undefined;
let beforeQuitRegistered = false;
let startupState: StartupRuntimeState = {
  status: 'starting',
  root: '',
  updatedAt: new Date().toISOString()
};

async function createWindow(): Promise<void> {
  const root = resolveDefaultAppRoot({ app });
  updateStartupState({ status: 'starting', root, error: undefined, lastStep: undefined });
  const recoveryRouter = createStartupRecoveryRouter({
    root,
    getState: () => startupState,
    retryStartup: () => {
      void startDesktopServices(root);
    }
  });
  registerElectronIpc(ipcMain, {
    invoke: (channel, payload, context) => {
      if (isStartupChannel(channel)) {
        return recoveryRouter.invoke(channel, payload, context);
      }
      return (activeServices?.router ?? recoveryRouter).invoke(channel, payload, context);
    }
  });

  const window = createManagedMainWindow(BrowserWindow, mainWindowRegistry, __dirname);
  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadURL(pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).toString());
  }
  void startDesktopServices(root);
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Failed to start Enterprise Agent Hub desktop', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function startDesktopServices(root: string): void {
  const attempt = ++startupAttempt;
  updateStartupState({ status: 'starting', root, error: undefined, lastStep: undefined });
  const startupReporter = (event: StartupStepEvent) => {
    if (attempt !== startupAttempt) return;
    if (event.status === 'start') {
      updateStartupState({ lastStep: event.step });
    }
    if (event.status === 'failed') {
      updateStartupState({ lastStep: event.step });
    }
  };

  const timeout = setTimeout(() => {
    if (attempt !== startupAttempt || startupState.status === 'ready') return;
    updateStartupState({
      status: 'failed',
      error: makeDesktopError(
        'startup_failed',
        `客户端本地服务初始化超时，卡在 ${startupState.lastStep ?? '未知步骤'}。`,
        undefined,
        { root, lastStep: startupState.lastStep, timeoutMs: startupTimeoutMs }
      )
    });
  }, startupTimeoutMs);

  createDesktopServices({ app, safeStorage, startupReporter })
    .then((services) => {
      if (attempt !== startupAttempt) {
        services.deviceHeartbeatScheduler.stop();
        void services.db.close();
        return;
      }
      clearTimeout(timeout);
      activateServices(services, root);
    })
    .catch((error) => {
      if (attempt !== startupAttempt || startupState.status === 'ready') return;
      clearTimeout(timeout);
      const desktopError = toDesktopError(error);
      updateStartupState({
        status: 'failed',
        error: makeDesktopError(
          desktopError.code === 'unknown_error' ? 'startup_failed' : desktopError.code,
          desktopError.message || '客户端本地服务初始化失败。',
          desktopError.requestID,
          { root, lastStep: startupState.lastStep, details: desktopError.details }
        )
      });
    });
}

function activateServices(services: DesktopServices, root: string): void {
  activeServices?.deviceHeartbeatScheduler.stop();
  activeServices = services;
  updateStartupState({ status: 'ready', root, error: undefined });
  services.deviceHeartbeatScheduler.start();
  if (!beforeQuitRegistered) {
    beforeQuitRegistered = true;
    app.once('before-quit', () => {
      activeServices?.deviceHeartbeatScheduler.stop();
    });
  }
  void services.clientUpdateService.reportStartupVersion().catch((error) => {
    void services.logger.warn('client_update.startup_report_failed', error);
  });
}

function updateStartupState(patch: Partial<StartupRuntimeState>): void {
  startupState = {
    ...startupState,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  if (patch.error) {
    console.error('Enterprise Agent Hub desktop startup failed', patch.error);
  }
}

function isStartupChannel(channel: string): boolean {
  return channel === IPC_CHANNELS.startupGetStatus
    || channel === IPC_CHANNELS.startupClearSession
    || channel === IPC_CHANNELS.startupRebuildLocalDatabase
    || channel === IPC_CHANNELS.startupRetry;
}
