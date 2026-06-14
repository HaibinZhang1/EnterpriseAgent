import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SafeStorageLike } from './security/secure-store';
import { ApiClient } from './api/api-client';
import { CacheRepository } from './cache/cache-repository';
import { OfflinePolicy } from './cache/offline-policy';
import { initializeAppDataLayout, resolveDefaultAppRoot, type AppRootProvider } from './config/app-paths';
import { DeviceIdStore, type DeviceInfo } from './config/device-id-store';
import { LocalDatabase } from './db/local-database';
import { LocalEventQueue } from './events/local-event-queue';
import { LocalEventSyncService } from './events/local-event-sync-service';
import { LocalExecutor } from './executor/local-executor';
import { DeviceHeartbeatScheduler } from './device/device-heartbeat-scheduler';
import { DeviceRegistrationService } from './device/device-registration-service';
import { LocalLifecycleRepository } from './lifecycle/local-lifecycle-repository';
import { LocalInventoryScanner } from './lifecycle/local-inventory-scanner';
import { ClientLogger } from './logging/client-logger';
import { McpService } from './mcp/mcp-service';
import { PackageDownloadService } from './packages/package-download-service';
import { PluginService } from './plugin/plugin-service';
import { SkillService } from './skill/skill-service';
import { createDryRunAdapters } from './tool-adapters/builtin';
import { AdapterRegistry } from './tool-adapters/registry';
import { ClientUpdateService, ShellClientUpdateLauncher, type ClientUpdateLauncher } from './update/client-update-service';
import { WindowsAuthenticodeSignatureVerifier, type SignatureVerifier } from './update/signature-verifier';
import { MemorySecureStore, SafeStorageSecureStore, type SecureStore } from './security/secure-store';
import { createDesktopIpcRouter } from './ipc/handlers';
import type { IpcRouter } from './ipc/ipc-router';

export interface CreateDesktopServicesOptions {
  rootOverride?: string;
  app?: AppRootProvider;
  baseURL?: string;
  clientVersion?: string;
  fetchImpl?: typeof fetch;
  safeStorage?: SafeStorageLike;
  signatureVerifier?: SignatureVerifier;
  updateLauncher?: ClientUpdateLauncher;
  heartbeatIntervalMs?: number;
  startupReporter?: (event: StartupStepEvent) => void;
}

export interface StartupStepEvent {
  step: string;
  status: 'start' | 'complete' | 'failed';
  error?: unknown;
}

export interface DesktopServices {
  apiClient: ApiClient;
  cacheRepository: CacheRepository;
  db: LocalDatabase;
  deviceInfo: DeviceInfo;
  eventQueue: LocalEventQueue;
  eventSyncService: LocalEventSyncService;
  deviceHeartbeatScheduler: DeviceHeartbeatScheduler;
  deviceRegistrationService: DeviceRegistrationService;
  clientUpdateService: ClientUpdateService;
  localExecutor: LocalExecutor;
  lifecycleRepository: LocalLifecycleRepository;
  localInventoryScanner: LocalInventoryScanner;
  mcpService: McpService;
  packageDownloadService: PackageDownloadService;
  pluginService: PluginService;
  skillService: SkillService;
  adapterRegistry: AdapterRegistry;
  logger: ClientLogger;
  offlinePolicy: OfflinePolicy;
  router: IpcRouter;
  secureStore: SecureStore;
  paths: Awaited<ReturnType<typeof initializeAppDataLayout>>;
}

export async function createDesktopServices(options: CreateDesktopServicesOptions = {}): Promise<DesktopServices> {
  const root = runStartupStepSync('resolve-app-root', options.startupReporter, () => resolveDefaultAppRoot({ app: options.app, rootOverride: options.rootOverride }));
  const paths = await runStartupStep('initialize-app-data-layout', options.startupReporter, () => initializeAppDataLayout(root));
  const deviceStore = new DeviceIdStore(paths, options.clientVersion ?? '0.1.0-m6');
  const deviceInfo = await runStartupStep('device-id-store', options.startupReporter, () => deviceStore.getOrCreate());
  const db = new LocalDatabase(paths.localDbFile);
  await runStartupStep('local-database-initialize', options.startupReporter, () => db.initialize());
  const logger = runStartupStepSync('client-logger-create', options.startupReporter, () => new ClientLogger(path.join(paths.logsDir, 'desktop.log')));
  const localConfig = await runStartupStep('read-local-config', options.startupReporter, () => readLocalConfig(paths.configFile, logger));
  const secureStore = runStartupStepSync('secure-store-create', options.startupReporter, () => options.safeStorage
    ? new SafeStorageSecureStore(path.join(paths.root, 'secure-store.json'), options.safeStorage)
    : new MemorySecureStore());
  const apiClient = new ApiClient({
    baseURL: options.baseURL ?? localConfig.baseURL ?? 'http://localhost:8080',
    getSessionToken: () => secureStore.get('session.token'),
    getDeviceID: async () => deviceInfo.deviceID,
    clientVersion: deviceInfo.clientVersion ?? options.clientVersion ?? '0.1.0-m6',
    fetchImpl: options.fetchImpl,
    logger
  });
  const eventQueue = new LocalEventQueue(db);
  const cacheRepository = new CacheRepository(paths);
  const offlinePolicy = new OfflinePolicy();
  const localExecutor = new LocalExecutor();
  const lifecycleRepository = new LocalLifecycleRepository(db);
  const localInventoryScanner = new LocalInventoryScanner(paths, lifecycleRepository);
  const eventSyncService = new LocalEventSyncService(eventQueue, (events) => apiClient.syncLocalEvents(events), {
    applyServerStateHints: (hints) => lifecycleRepository.applyServerStateHints(hints)
  });
  const mcpService = new McpService(secureStore);
  const packageDownloadService = new PackageDownloadService(apiClient, paths);
  const pluginService = new PluginService();
  const skillService = new SkillService(paths);
  const adapterRegistry = new AdapterRegistry();
  for (const adapter of createDryRunAdapters()) adapterRegistry.register(adapter);
  const deviceRegistrationService = new DeviceRegistrationService(apiClient, async () => deviceInfo, () => eventQueue.listPending().length);
  const deviceHeartbeatScheduler = new DeviceHeartbeatScheduler((requestID) => deviceRegistrationService.heartbeat(requestID), {
    intervalMs: options.heartbeatIntervalMs,
    onError: (error) => logger.warn('device.heartbeat.failed', error)
  });
  const clientUpdateService = new ClientUpdateService({
    apiClient,
    getDeviceInfo: async () => deviceInfo,
    registerDevice: (requestID) => deviceRegistrationService.register(requestID),
    downloadsDir: path.join(paths.root, 'updates'),
    startupStateFile: path.join(paths.root, 'client-update-startup.json'),
    signatureVerifier: options.signatureVerifier ?? new WindowsAuthenticodeSignatureVerifier(),
    launcher: options.updateLauncher ?? new ShellClientUpdateLauncher()
  });
  const router = createDesktopIpcRouter({
    apiClient,
    cacheRepository,
    eventQueue,
    eventSyncService,
    getDeviceInfo: async () => deviceInfo,
    lifecycleRepository,
    localInventoryScanner,
    localExecutor,
    logger,
    mcpService,
    offlinePolicy,
    packageDownloadService,
    paths,
    pluginService,
    adapterRegistry,
    secureStore,
    skillService,
    db,
    deviceRegistrationService,
    clientUpdateService
  });

  return {
    apiClient,
    cacheRepository,
    db,
    deviceInfo,
    eventQueue,
    eventSyncService,
    deviceHeartbeatScheduler,
    deviceRegistrationService,
    clientUpdateService,
    lifecycleRepository,
    localInventoryScanner,
    localExecutor,
    logger,
    mcpService,
    offlinePolicy,
    packageDownloadService,
    adapterRegistry,
    paths,
    pluginService,
    router,
    secureStore,
    skillService
  };
}

async function runStartupStep<T>(step: string, reporter: CreateDesktopServicesOptions['startupReporter'], action: () => Promise<T>): Promise<T> {
  reporter?.({ step, status: 'start' });
  try {
    const value = await action();
    reporter?.({ step, status: 'complete' });
    return value;
  } catch (error) {
    reporter?.({ step, status: 'failed', error });
    throw error;
  }
}

function runStartupStepSync<T>(step: string, reporter: CreateDesktopServicesOptions['startupReporter'], action: () => T): T {
  reporter?.({ step, status: 'start' });
  try {
    const value = action();
    reporter?.({ step, status: 'complete' });
    return value;
  } catch (error) {
    reporter?.({ step, status: 'failed', error });
    throw error;
  }
}

async function readLocalConfig(file: string, logger: ClientLogger): Promise<{ baseURL?: string }> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    return { baseURL: typeof parsed.baseURL === 'string' && parsed.baseURL ? parsed.baseURL : undefined };
  } catch (error) {
    await logger.warn('config.read.failed', error);
    return {};
  }
}
