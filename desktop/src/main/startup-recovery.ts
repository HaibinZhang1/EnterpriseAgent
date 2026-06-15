import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildAppPaths } from './config/app-paths';
import { IPC_CHANNELS, ALLOWED_IPC_CHANNELS, type IpcChannel } from './ipc/channels';
import { IpcRouter } from './ipc/ipc-router';
import { DesktopErrorException, makeDesktopError, type DesktopError } from '../shared/errors';

export interface StartupRuntimeState {
  status: 'starting' | 'ready' | 'failed';
  root: string;
  lastStep?: string;
  error?: DesktopError;
  updatedAt: string;
}

export interface StartupRecoveryRouterOptions {
  root: string;
  getState: () => StartupRuntimeState;
  retryStartup: () => void;
}

export function createStartupRecoveryRouter(options: StartupRecoveryRouterOptions): IpcRouter {
  const router = new IpcRouter();
  for (const channel of ALLOWED_IPC_CHANNELS) {
    router.register(channel as IpcChannel, (_payload, context) => {
      throw startupUnavailableError(options.getState(), context.requestID);
    });
  }

  router.register(IPC_CHANNELS.startupGetStatus, () => publicStartupState(options.getState()));
  router.register(IPC_CHANNELS.startupClearSession, async () => clearStartupSession(options.root));
  router.register(IPC_CHANNELS.startupRebuildLocalDatabase, async () => {
    if (options.getState().status === 'ready') {
      return { rebuilt: false, skippedReason: 'services_ready' };
    }
    return rebuildStartupLocalDatabase(options.root);
  });
  router.register(IPC_CHANNELS.startupRetry, () => {
    options.retryStartup();
    return publicStartupState(options.getState());
  });

  router.register(IPC_CHANNELS.authGetSession, (_payload, context) => {
    throw startupUnavailableError(options.getState(), context.requestID);
  });
  router.register(IPC_CHANNELS.authLogout, () => clearStartupSession(options.root));
  router.register(IPC_CHANNELS.settingsGetLocalConfig, () => readStartupConfig(options.root));
  router.register(IPC_CHANNELS.localGetOfflineState, () => ({
    online: false,
    checkedAt: new Date().toISOString(),
    reason: '客户端本地服务尚未完成初始化。',
    installDecision: { allowed: false, reason: '本地服务恢复前暂不可执行服务端授权操作。' }
  }));
  router.register(IPC_CHANNELS.localListPendingEvents, () => []);
  router.register(IPC_CHANNELS.localListLifecycle, () => ({
    extensions: [],
    versions: [],
    targets: [],
    tools: [],
    projects: [],
    mcpInstallations: [],
    pluginInstallations: [],
    resources: emptyLocalResourceSnapshot()
  }));
  router.register(IPC_CHANNELS.localListResources, () => emptyLocalResourceSnapshot());
  router.register(IPC_CHANNELS.localScanInventory, () => ({ scannedAt: new Date().toISOString(), discovered: { total: 0 } }));
  router.register(IPC_CHANNELS.logsGetRecent, () => []);
  router.register(IPC_CHANNELS.clientUpdateGetPending, () => undefined);

  return router;
}

function emptyLocalResourceSnapshot(): Record<string, unknown> {
  return {
    resources: [],
    bindings: [],
    files: [],
    events: [],
    rows: [],
    summary: {
      resourceCount: 0,
      bindingCount: 0,
      fileCount: 0,
      eventCount: 0,
      pendingSyncEvents: 0,
      failureCount: 0,
      generatedAt: new Date().toISOString()
    }
  };
}

export interface ClearStartupSessionResult {
  cleared: true;
  path: string;
  removedSession: boolean;
  preservedEntries: number;
  backupPath?: string;
  resetStore?: boolean;
  message?: string;
}

export async function clearStartupSession(root: string): Promise<ClearStartupSessionResult> {
  const secureStoreFile = path.join(root, 'secure-store.json');
  let store: Record<string, unknown>;
  try {
    store = JSON.parse(await readFile(secureStoreFile, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if (isMissingFileError(error)) {
      return { cleared: true, path: secureStoreFile, removedSession: false, preservedEntries: 0 };
    }
    return backupStartupSecureStore(root, secureStoreFile, '无法安全读取');
  }

  const entries = store && typeof store === 'object' && !Array.isArray(store) ? store.entries : undefined;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return backupStartupSecureStore(root, secureStoreFile, '格式异常');
  }

  const nextEntries = { ...(entries as Record<string, unknown>) };
  const removedSession = Object.prototype.hasOwnProperty.call(nextEntries, 'session.token');
  if (removedSession) {
    delete nextEntries['session.token'];
  }
  if (!secureStoreEntriesAreValid(nextEntries)) {
    return backupStartupSecureStore(root, secureStoreFile, '包含异常密钥记录');
  }
  if (removedSession) {
    await writeFile(secureStoreFile, `${JSON.stringify({ ...store, entries: nextEntries }, null, 2)}\n`, 'utf8');
  }
  return {
    cleared: true,
    path: secureStoreFile,
    removedSession,
    preservedEntries: Object.keys(nextEntries).length
  };
}

export async function rebuildStartupLocalDatabase(root: string): Promise<{ rebuilt: true; backupPath?: string }> {
  const paths = buildAppPaths(root);
  await mkdir(paths.root, { recursive: true });
  const backupPath = `${paths.localDbFile}.rebuild-${Date.now()}.bak`;
  try {
    await rename(paths.localDbFile, backupPath);
    return { rebuilt: true, backupPath };
  } catch (error) {
    if (isMissingFileError(error)) return { rebuilt: true };
    throw error;
  }
}

export function startupUnavailableError(state: StartupRuntimeState, requestID?: string): Error {
  const error = state.error ?? makeDesktopError(
    'startup_failed',
    '客户端本地服务仍在初始化，请稍后重试。',
    requestID,
    { root: state.root, lastStep: state.lastStep, status: state.status }
  );
  return new DesktopErrorException({ ...error, requestID: requestID ?? error.requestID });
}

function publicStartupState(state: StartupRuntimeState): Record<string, unknown> {
  return {
    status: state.status,
    root: state.root,
    lastStep: state.lastStep,
    updatedAt: state.updatedAt,
    error: state.error
  };
}

async function readStartupConfig(root: string): Promise<Record<string, unknown>> {
  const paths = buildAppPaths(root);
  try {
    return JSON.parse(await readFile(paths.configFile, 'utf8')) as Record<string, unknown>;
  } catch {
    return { baseURL: 'http://localhost:8080', theme: 'system', notificationsEnabled: true };
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function secureStoreEntriesAreValid(entries: Record<string, unknown>): boolean {
  return Object.values(entries).every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as { encrypted?: unknown; updatedAt?: unknown };
    return typeof record.encrypted === 'string' && typeof record.updatedAt === 'string';
  });
}

async function backupStartupSecureStore(root: string, secureStoreFile: string, reason: string): Promise<ClearStartupSessionResult> {
  await mkdir(root, { recursive: true });
  const backupPath = `${secureStoreFile}.session-clear-${Date.now()}.bak`;
  try {
    await rename(secureStoreFile, backupPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { cleared: true, path: secureStoreFile, removedSession: false, preservedEntries: 0 };
    }
    throw error;
  }
  return {
    cleared: true,
    path: secureStoreFile,
    removedSession: false,
    preservedEntries: 0,
    resetStore: true,
    backupPath,
    message: `本地安全存储文件${reason}，已备份并重置；请重新登录。`
  };
}
