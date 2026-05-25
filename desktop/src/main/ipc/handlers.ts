import { readFile } from 'node:fs/promises';
import { requiredString, assertRecord, optionalString } from '../../shared/validation';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';
import type { ApiClient } from '../api/api-client';
import type { CacheRepository } from '../cache/cache-repository';
import type { OfflinePolicy } from '../cache/offline-policy';
import type { AppPaths } from '../config/app-paths';
import type { DeviceInfo } from '../config/device-id-store';
import type { DeviceRegistrationService } from '../device/device-registration-service';
import type { LocalEventQueue } from '../events/local-event-queue';
import type { LocalExecutor } from '../executor/local-executor';
import type { LocalLifecycleRepository } from '../lifecycle/local-lifecycle-repository';
import type { ClientLogger } from '../logging/client-logger';
import type { SecureStore } from '../security/secure-store';
import type { SkillService } from '../skill/skill-service';
import type { ClientUpdateService } from '../update/client-update-service';
import { IPC_CHANNELS } from './channels';
import { IpcRouter } from './ipc-router';
import { sanitizeLoginResult } from './sanitize';

export interface DesktopIpcServices {
  apiClient: ApiClient;
  secureStore: SecureStore;
  eventQueue: LocalEventQueue;
  cacheRepository: CacheRepository;
  offlinePolicy: OfflinePolicy;
  localExecutor: LocalExecutor;
  lifecycleRepository: LocalLifecycleRepository;
  skillService: SkillService;
  deviceRegistrationService: DeviceRegistrationService;
  clientUpdateService: ClientUpdateService;
  logger: ClientLogger;
  paths: AppPaths;
  getDeviceInfo: () => Promise<DeviceInfo>;
}

export function createDesktopIpcRouter(services: DesktopIpcServices): IpcRouter {
  const router = new IpcRouter();

  router.register(IPC_CHANNELS.authLogin, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const username = requiredString(record, 'username', context.requestID);
    const password = requiredString(record, 'password', context.requestID);
    const device = await services.getDeviceInfo();
    const result = await services.apiClient.login({
      phone: username,
      password,
      clientType: 'DESKTOP',
      deviceId: device.deviceID,
      clientVersion: device.clientVersion
    }, context.requestID);
    if (typeof result === 'object' && result && 'token' in result && typeof result.token === 'string') {
      await services.secureStore.set('session.token', result.token);
      await services.deviceRegistrationService.register(context.requestID);
    }
    return sanitizeLoginResult(result);
  });

  router.register(IPC_CHANNELS.authLogout, async (_payload, context) => {
    await services.secureStore.delete('session.token');
    return services.apiClient.logout(context.requestID);
  });

  router.register(IPC_CHANNELS.authGetSession, async () => ({ hasSession: Boolean(await services.secureStore.get('session.token')) }));
  router.register(IPC_CHANNELS.catalogHome, (_payload, context) => services.apiClient.communityHome(context.requestID));
  router.register(IPC_CHANNELS.catalogSearch, (payload, context) => {
    const record = assertRecord(payload ?? {}, context.requestID);
    return services.apiClient.searchExtensions(optionalString(record, 'q', context.requestID) ?? '', context.requestID);
  });
  router.register(IPC_CHANNELS.extensionGetDetail, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.extensionDetail(requiredString(record, 'extensionID', context.requestID), context.requestID);
  });
  router.register(IPC_CHANNELS.extensionGetVersions, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.extensionVersions(requiredString(record, 'extensionID', context.requestID), context.requestID);
  });
  router.register(IPC_CHANNELS.deviceGetInfo, () => services.getDeviceInfo());
  router.register(IPC_CHANNELS.localGetStatus, async () => ({ root: services.paths.root, pendingEvents: services.eventQueue.listPending().length }));
  router.register(IPC_CHANNELS.localGetOfflineState, () => ({ online: false, installDecision: services.offlinePolicy.decide('extension.install', false) }));
  router.register(IPC_CHANNELS.localEnqueueEvent, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.eventQueue.enqueue({
      deviceID: requiredString(record, 'deviceID', context.requestID),
      userID: optionalString(record, 'userID', context.requestID),
      extensionID: optionalString(record, 'extensionID', context.requestID),
      version: optionalString(record, 'version', context.requestID),
      eventType: requiredString(record, 'eventType', context.requestID),
      result: optionalString(record, 'result', context.requestID),
      errorCode: optionalString(record, 'errorCode', context.requestID),
      idempotencyKey: optionalString(record, 'idempotencyKey', context.requestID),
      payload: typeof record.payload === 'object' && record.payload ? record.payload as Record<string, unknown> : {}
    });
  });
  router.register(IPC_CHANNELS.localListPendingEvents, () => services.eventQueue.listPending());
  router.register(IPC_CHANNELS.settingsGetLocalConfig, async () => JSON.parse(await readFile(services.paths.configFile, 'utf8')) as unknown);
  router.register(IPC_CHANNELS.logsGetRecent, () => services.logger.recent());
  router.register(IPC_CHANNELS.clientUpdateCheck, (_payload, context) => services.clientUpdateService.check(context.requestID));
  router.register(IPC_CHANNELS.clientUpdateGetPending, () => services.clientUpdateService.getPending());
  router.register(IPC_CHANNELS.clientUpdateConfirmDownload, (_payload, context) => services.clientUpdateService.confirmDownload(context.requestID));
  router.register(IPC_CHANNELS.clientUpdateCancel, (payload, context) => {
    const record = payload === undefined ? {} : assertRecord(payload, context.requestID);
    return services.clientUpdateService.cancel(optionalString(record, 'reason', context.requestID) ?? 'USER_CANCELLED', context.requestID);
  });
  router.register(IPC_CHANNELS.clientUpdateConfirmInstall, (_payload, context) => services.clientUpdateService.confirmInstall(context.requestID));
  router.register(IPC_CHANNELS.extensionInstall, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredString(record, 'extensionID', context.requestID);
    const version = optionalString(record, 'version', context.requestID) ?? '1.0.0';
    const targetPath = requiredString(record, 'targetPath', context.requestID);
    const dryRun = record.dryRun !== false;
    const decision = services.offlinePolicy.decide('extension.install', true, context.requestID);
    if (!decision.allowed) {
      throw new DesktopErrorException(decision.error ?? makeDesktopError('offline_server_authority_required', decision.reason, context.requestID));
    }
    const plan = services.skillService.createEnablePlan({ extensionId, version, targetPath, dryRun, requestID: context.requestID });
    if (dryRun) return plan;
    const result = await services.localExecutor.execute(plan, {
      allowedRoots: [services.paths.root],
      managedPaths: [targetPath],
      backupRoot: services.paths.backupsDir,
      eventQueue: services.eventQueue,
      deviceID: (await services.getDeviceInfo()).deviceID
    });
    if (result.status === 'success') {
      await services.lifecycleRepository.recordTarget({ extensionId, target: targetPath, status: 'enabled', metadata: { version } });
    }
    return result;
  });

  return router;
}
