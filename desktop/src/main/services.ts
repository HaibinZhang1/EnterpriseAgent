import path from 'node:path';
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
import { DeviceRegistrationService } from './device/device-registration-service';
import { LocalLifecycleRepository } from './lifecycle/local-lifecycle-repository';
import { ClientLogger } from './logging/client-logger';
import { McpService } from './mcp/mcp-service';
import { PackageDownloadService } from './packages/package-download-service';
import { PluginService } from './plugin/plugin-service';
import { SkillService } from './skill/skill-service';
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
}

export interface DesktopServices {
  apiClient: ApiClient;
  cacheRepository: CacheRepository;
  db: LocalDatabase;
  deviceInfo: DeviceInfo;
  eventQueue: LocalEventQueue;
  eventSyncService: LocalEventSyncService;
  deviceRegistrationService: DeviceRegistrationService;
  clientUpdateService: ClientUpdateService;
  localExecutor: LocalExecutor;
  lifecycleRepository: LocalLifecycleRepository;
  mcpService: McpService;
  packageDownloadService: PackageDownloadService;
  pluginService: PluginService;
  skillService: SkillService;
  logger: ClientLogger;
  offlinePolicy: OfflinePolicy;
  router: IpcRouter;
  secureStore: SecureStore;
  paths: Awaited<ReturnType<typeof initializeAppDataLayout>>;
}

export async function createDesktopServices(options: CreateDesktopServicesOptions = {}): Promise<DesktopServices> {
  const root = resolveDefaultAppRoot({ app: options.app, rootOverride: options.rootOverride });
  const paths = await initializeAppDataLayout(root);
  const deviceStore = new DeviceIdStore(paths, options.clientVersion ?? '0.1.0-m6');
  const deviceInfo = await deviceStore.getOrCreate();
  const db = new LocalDatabase(paths.localDbFile);
  await db.initialize();
  const logger = new ClientLogger(path.join(paths.logsDir, 'desktop.log'));
  const secureStore = options.safeStorage
    ? new SafeStorageSecureStore(path.join(paths.root, 'secure-store.json'), options.safeStorage)
    : new MemorySecureStore();
  const apiClient = new ApiClient({
    baseURL: options.baseURL ?? 'http://localhost:8080',
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
  const eventSyncService = new LocalEventSyncService(eventQueue, (events) => apiClient.syncLocalEvents(events), {
    applyServerStateHints: (hints) => lifecycleRepository.applyServerStateHints(hints)
  });
  const mcpService = new McpService(secureStore);
  const packageDownloadService = new PackageDownloadService(apiClient, paths);
  const pluginService = new PluginService();
  const skillService = new SkillService(paths);
  const deviceRegistrationService = new DeviceRegistrationService(apiClient, async () => deviceInfo);
  const clientUpdateService = new ClientUpdateService({
    apiClient,
    getDeviceInfo: async () => deviceInfo,
    downloadsDir: path.join(paths.root, 'updates'),
    signatureVerifier: options.signatureVerifier ?? new WindowsAuthenticodeSignatureVerifier(),
    launcher: options.updateLauncher ?? new ShellClientUpdateLauncher()
  });
  const router = createDesktopIpcRouter({
    apiClient,
    cacheRepository,
    eventQueue,
    getDeviceInfo: async () => deviceInfo,
    lifecycleRepository,
    localExecutor,
    logger,
    offlinePolicy,
    paths,
    secureStore,
    skillService,
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
    deviceRegistrationService,
    clientUpdateService,
    lifecycleRepository,
    localExecutor,
    logger,
    mcpService,
    offlinePolicy,
    packageDownloadService,
    paths,
    pluginService,
    router,
    secureStore,
    skillService
  };
}
