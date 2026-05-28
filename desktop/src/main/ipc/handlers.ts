import { readFile, writeFile } from 'node:fs/promises';
import { requiredString, assertRecord, optionalString, optionalBoolean, optionalRecord, requiredRecord, type RecordPayload } from '../../shared/validation';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';
import type { ApiClient } from '../api/api-client';
import type { CacheRepository } from '../cache/cache-repository';
import type { OfflinePolicy } from '../cache/offline-policy';
import type { AppPaths } from '../config/app-paths';
import type { DeviceInfo } from '../config/device-id-store';
import type { LocalDatabase } from '../db/local-database';
import type { DeviceRegistrationService } from '../device/device-registration-service';
import type { LocalEventQueue } from '../events/local-event-queue';
import type { LocalEventSyncService, NetworkRecoverySyncInput } from '../events/local-event-sync-service';
import type { LocalExecutor } from '../executor/local-executor';
import type { LocalLifecycleRepository } from '../lifecycle/local-lifecycle-repository';
import type { LocalInventoryScanner } from '../lifecycle/local-inventory-scanner';
import type { ClientLogger } from '../logging/client-logger';
import type { McpDefinition, McpService } from '../mcp/mcp-service';
import type { PluginInstallMode, PluginService } from '../plugin/plugin-service';
import type { SecureStore } from '../security/secure-store';
import type { SkillService } from '../skill/skill-service';
import type { ClientUpdateService } from '../update/client-update-service';
import { IPC_CHANNELS } from './channels';
import { IpcRouter } from './ipc-router';
import { sanitizeLoginResult } from './sanitize';

export interface DesktopIpcServices {
  apiClient: ApiClient;
  db: LocalDatabase;
  secureStore: SecureStore;
  eventQueue: LocalEventQueue;
  eventSyncService: LocalEventSyncService;
  cacheRepository: CacheRepository;
  offlinePolicy: OfflinePolicy;
  localExecutor: LocalExecutor;
  lifecycleRepository: LocalLifecycleRepository;
  localInventoryScanner: LocalInventoryScanner;
  mcpService: McpService;
  pluginService: PluginService;
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
      await services.clientUpdateService.reportStartupVersion(context.requestID).catch((error) => {
        void services.logger.warn('client_update.startup_report_failed', error, context.requestID);
      });
    }
    return sanitizeLoginResult(result);
  });

  router.register(IPC_CHANNELS.authLogout, async (_payload, context) => {
    await services.secureStore.delete('session.token');
    return services.apiClient.logout(context.requestID);
  });

  router.register(IPC_CHANNELS.authGetSession, async () => ({ hasSession: Boolean(await services.secureStore.get('session.token')) }));
  router.register(IPC_CHANNELS.authMe, (_payload, context) => services.apiClient.me(context.requestID));
  router.register(IPC_CHANNELS.authChangePassword, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.changePassword({
      oldPassword: requiredString(record, 'oldPassword', context.requestID),
      newPassword: requiredString(record, 'newPassword', context.requestID)
    }, context.requestID);
  });
  router.register(IPC_CHANNELS.authCompleteResetPassword, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.completeResetPassword({
      resetToken: requiredString(record, 'resetToken', context.requestID),
      newPassword: requiredString(record, 'newPassword', context.requestID)
    }, context.requestID);
  });
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
  router.register(IPC_CHANNELS.extensionSetStar, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.setStar(
      requiredString(record, 'extensionID', context.requestID),
      optionalBoolean(record, 'starred', context.requestID) ?? false,
      context.requestID
    );
  });
  router.register(IPC_CHANNELS.extensionGetMcpDefinition, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.getMcpDefinition(requiredString(record, 'extensionID', context.requestID), context.requestID);
  });
  router.register(IPC_CHANNELS.extensionGetPluginDefinition, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.getPluginDefinition(requiredString(record, 'extensionID', context.requestID), context.requestID);
  });
  router.register(IPC_CHANNELS.deviceGetInfo, () => services.getDeviceInfo());
  router.register(IPC_CHANNELS.localGetStatus, async () => ({ root: services.paths.root, pendingEvents: services.eventQueue.listPending().length }));
  router.register(IPC_CHANNELS.localGetOfflineState, async (_payload, context) => {
    const checkedAt = new Date().toISOString();
    try {
      await services.apiClient.health(context.requestID);
      return { online: true, checkedAt, installDecision: services.offlinePolicy.decide('extension.install', true, context.requestID) };
    } catch (error) {
      const reason = error instanceof DesktopErrorException ? error.desktopError.message : 'Server is unavailable';
      return { online: false, checkedAt, reason, installDecision: services.offlinePolicy.decide('extension.install', false, context.requestID) };
    }
  });
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
  router.register(IPC_CHANNELS.localScanInventory, () => services.localInventoryScanner.scan());
  router.register(IPC_CHANNELS.localListLifecycle, async () => {
    await services.localInventoryScanner.scan();
    return services.lifecycleRepository.list();
  });
  router.register(IPC_CHANNELS.localSyncPending, (payload, context) => {
    const record = payload === undefined ? {} : assertRecord(payload, context.requestID);
    return services.eventSyncService.syncAfterNetworkRecovery({
      online: optionalBoolean(record, 'online', context.requestID) ?? true,
      previousOnline: optionalBoolean(record, 'previousOnline', context.requestID) ?? false,
      reason: normalizeSyncReason(optionalString(record, 'reason', context.requestID), context.requestID)
    });
  });
  router.register(IPC_CHANNELS.localCleanup, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredExtensionId(record, context.requestID);
    const target = optionalString(record, 'target', context.requestID) ?? optionalString(record, 'configPath', context.requestID);
    const kind = normalizeLocalKind(optionalString(record, 'localKind', context.requestID), record);
    const metadata = optionalRecord(record, 'metadata', context.requestID) ?? {};
    const version = stringValue(record.version ?? metadata.version, '1.0.0');
    const dryRun = optionalBoolean(record, 'dryRun', context.requestID) ?? false;
    const decision = services.offlinePolicy.decide('local.cleanup.entry', false, context.requestID);
    if (!decision.allowed) {
      throw new DesktopErrorException(decision.error ?? makeDesktopError('offline_server_authority_required', decision.reason, context.requestID));
    }
    if (!target) {
      if (!dryRun) await services.lifecycleRepository.markCleaned({ extensionId, kind, metadata: { reason: 'cache_record_only' } });
      return { result: { status: dryRun ? 'dry_run' : 'success', message: 'Local lifecycle cache record cleanup completed' } };
    }

    const plan = kind === 'mcp'
      ? services.mcpService.createUninstallPlan({ definition: { extensionId, version, configTemplate: {} }, targetConfigPath: target, dryRun, requestID: context.requestID })
      : kind === 'plugin'
        ? services.pluginService.createPlan({ extensionId, version, installMode: 'MANAGED_PACKAGE', targetPath: target, operation: 'uninstall', dryRun, requestID: context.requestID })
        : services.skillService.createUninstallPlan({ extensionId, version, targetPath: target, dryRun, requestID: context.requestID });
    const result = await services.localExecutor.execute(plan, {
      allowedRoots: [services.paths.root],
      managedPaths: [target],
      backupRoot: services.paths.backupsDir,
      db: services.db,
      eventQueue: services.eventQueue,
      deviceID: (await services.getDeviceInfo()).deviceID
    });
    if (!dryRun && result.status === 'success') {
      await services.lifecycleRepository.markCleaned({ extensionId, target, kind, metadata: { operation: plan.operation } });
    }
    return { plan, result };
  });
  router.register(IPC_CHANNELS.settingsGetLocalConfig, async () => JSON.parse(await readFile(services.paths.configFile, 'utf8')) as unknown);
  router.register(IPC_CHANNELS.settingsSaveLocalConfig, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const current = JSON.parse(await readFile(services.paths.configFile, 'utf8')) as Record<string, unknown>;
    const next = sanitizeLocalConfig(record, context.requestID);
    const saved = { ...current, ...next, updatedAt: new Date().toISOString() };
    await writeFile(services.paths.configFile, `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
    return saved;
  });
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
    const dryRun = optionalBoolean(record, 'dryRun', context.requestID) ?? true;
    const decision = services.offlinePolicy.decide('extension.install', true, context.requestID);
    if (!decision.allowed) {
      throw new DesktopErrorException(decision.error ?? makeDesktopError('offline_server_authority_required', decision.reason, context.requestID));
    }
    const plan = services.skillService.createEnablePlan({ extensionId, version, targetPath, dryRun, requestID: context.requestID });
    const result = await services.localExecutor.execute(plan, {
      allowedRoots: [services.paths.root],
      managedPaths: [targetPath],
      backupRoot: services.paths.backupsDir,
      db: services.db,
      eventQueue: services.eventQueue,
      deviceID: (await services.getDeviceInfo()).deviceID
    });
    if (!dryRun && result.status === 'success') {
      await services.lifecycleRepository.recordTarget({ extensionId, target: targetPath, status: 'enabled', metadata: { version } });
    }
    return { plan, result };
  });

  router.register(IPC_CHANNELS.mcpConfigure, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredString(record, 'extensionID', context.requestID);
    const targetConfigPath = requiredString(record, 'targetConfigPath', context.requestID);
    const variables = stringMap(optionalRecord(record, 'variables', context.requestID) ?? {}, context.requestID);
    const dryRun = optionalBoolean(record, 'dryRun', context.requestID) ?? true;
    const decision = services.offlinePolicy.decide('mcp.config.write', true, context.requestID);
    if (!decision.allowed) {
      throw new DesktopErrorException(decision.error ?? makeDesktopError('offline_server_authority_required', decision.reason, context.requestID));
    }
    const definition = normalizeMcpDefinition(await services.apiClient.getMcpDefinition(extensionId, context.requestID), extensionId);
    const existing = services.lifecycleRepository.findMcpInstallation(extensionId, targetConfigPath);
    const previousVariablesSchema = normalizeVariablesSchema(recordValue(existing?.metadata, 'variablesSchema'));
    const output = existing
      ? await services.mcpService.createUpdatePlan({ definition, targetConfigPath, variables, previousVariablesSchema, dryRun, requestID: context.requestID })
      : await services.mcpService.createConfigWritePlan({ definition, targetConfigPath, variables, dryRun, requestID: context.requestID });
    const result = await services.localExecutor.execute(output.plan, {
      allowedRoots: [services.paths.root],
      managedPaths: [targetConfigPath],
      backupRoot: services.paths.backupsDir,
      db: services.db,
      eventQueue: services.eventQueue,
      deviceID: (await services.getDeviceInfo()).deviceID
    });
    if (!dryRun && result.status === 'success') {
      await services.lifecycleRepository.recordMcpInstallation({
        extensionId,
        target: targetConfigPath,
        status: 'connected',
        configPath: targetConfigPath,
        secureRef: Object.values(output.secretRefs)[0],
        metadata: { version: definition.version, variableChanges: output.variableChanges, variablesSchema: definition.variablesSchema, operation: output.plan.operation }
      });
    }
    return { definition, redactedPreview: output.redactedPreview, variableChanges: output.variableChanges, plan: output.plan, result };
  });

  router.register(IPC_CHANNELS.mcpConnectionTest, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredString(record, 'extensionID', context.requestID);
    const definition = normalizeMcpDefinition(await services.apiClient.getMcpDefinition(extensionId, context.requestID), extensionId);
    return services.mcpService.executeConnectionTest(definition.connectionTest, {
      requestID: context.requestID,
      extensionId,
      version: definition.version,
      deviceID: (await services.getDeviceInfo()).deviceID,
      eventQueue: services.eventQueue
    });
  });

  router.register(IPC_CHANNELS.pluginPrepare, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredString(record, 'extensionID', context.requestID);
    const definition = normalizePluginDefinition(await services.apiClient.getPluginDefinition(extensionId, context.requestID), extensionId);
    const targetPath = requiredString(record, 'targetPath', context.requestID);
    const installMode = normalizePluginInstallMode(optionalString(record, 'installMode', context.requestID) ?? definition.installMode, context.requestID);
    const dryRun = optionalBoolean(record, 'dryRun', context.requestID) ?? true;
    const decision = services.offlinePolicy.decide('plugin.install', true, context.requestID);
    if (!decision.allowed) {
      throw new DesktopErrorException(decision.error ?? makeDesktopError('offline_server_authority_required', decision.reason, context.requestID));
    }
    const plan = services.pluginService.createPlan({
      extensionId,
      version: definition.version,
      installMode,
      targetPath,
      packagePath: optionalString(record, 'packagePath', context.requestID) ?? definition.packagePath,
      expectedSha256: definition.expectedSha256,
      operation: normalizePluginOperation(optionalString(record, 'operation', context.requestID), context.requestID),
      manifest: definition.manifest,
      manualInstructions: definition.manualInstructions,
      manualInstructionsUrl: definition.manualInstructionsUrl,
      dryRun,
      requestID: context.requestID
    });
    const result = await services.localExecutor.execute(plan, {
      allowedRoots: [services.paths.root],
      managedPaths: [targetPath],
      backupRoot: services.paths.backupsDir,
      db: services.db,
      eventQueue: services.eventQueue,
      deviceID: (await services.getDeviceInfo()).deviceID
    });
    if (!dryRun && result.status === 'success') {
      await services.lifecycleRepository.recordPluginInstallation({
        extensionId,
        target: targetPath,
        status: 'installed',
        adapterId: installMode,
        metadata: { version: definition.version, operation: plan.operation }
      });
    }
    return { definition, plan, result };
  });

  router.register(IPC_CHANNELS.publishUploadPackage, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.uploadPackage({
      uploadType: requiredString(record, 'uploadType', context.requestID),
      fileName: requiredString(record, 'fileName', context.requestID),
      mimeType: optionalString(record, 'mimeType', context.requestID),
      contentBase64: requiredString(record, 'contentBase64', context.requestID)
    }, context.requestID);
  });

  router.register(IPC_CHANNELS.publishCreateSubmission, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.createSubmission(submissionPayload(record, context.requestID), context.requestID, optionalString(record, 'idempotencyKey', context.requestID));
  });

  router.register(IPC_CHANNELS.publishListMine, (_payload, context) => services.apiClient.listMySubmissions(context.requestID));
  router.register(IPC_CHANNELS.publishGetSubmission, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.getSubmission(requiredString(record, 'submissionID', context.requestID), context.requestID);
  });
  router.register(IPC_CHANNELS.publishWithdraw, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.withdrawSubmission(requiredString(record, 'submissionID', context.requestID), context.requestID, optionalString(record, 'idempotencyKey', context.requestID));
  });
  router.register(IPC_CHANNELS.publishResubmit, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.resubmitSubmission(
      requiredString(record, 'submissionID', context.requestID),
      requiredRecord(record, 'payload', context.requestID),
      context.requestID,
      optionalString(record, 'idempotencyKey', context.requestID)
    );
  });

  router.register(IPC_CHANNELS.notificationsList, (_payload, context) => services.apiClient.listNotifications(context.requestID));
  router.register(IPC_CHANNELS.notificationsRead, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.apiClient.markNotificationRead(requiredString(record, 'notificationID', context.requestID), context.requestID);
  });

  return router;
}

function sanitizeLocalConfig(payload: RecordPayload, requestID?: string): Record<string, unknown> {
  const allowedStringKeys = new Set(['baseURL', 'theme', 'language', 'defaultPage', 'updateChannel']);
  const allowedBooleanKeys = new Set(['autoSync', 'successToastMode', 'notificationsEnabled']);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/(api[_-]?key|authorization|credential|password|secret|token)/i.test(key)) {
      throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} is managed by secure storage and cannot be saved in local settings`, requestID));
    }
    if (allowedStringKeys.has(key)) {
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} must be a string`, requestID));
      }
      output[key] = value;
    } else if (allowedBooleanKeys.has(key)) {
      if (value !== undefined && value !== null && typeof value !== 'boolean') {
        throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} must be a boolean`, requestID));
      }
      output[key] = value;
    }
  }
  return output;
}

function stringMap(record: RecordPayload, requestID?: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} must be a string`, requestID));
    }
    output[key] = value;
  }
  return output;
}

function normalizeMcpDefinition(value: unknown, fallbackExtensionId: string): McpDefinition {
  const record = assertRecord(value, undefined);
  const configTemplate = record.configTemplate && typeof record.configTemplate === 'object' && !Array.isArray(record.configTemplate)
    ? record.configTemplate as Record<string, unknown>
    : {};
  return {
    extensionId: stringValue(record.extensionId ?? record.extensionID, fallbackExtensionId),
    version: stringValue(record.version, '1.0.0'),
    configTemplate,
    variablesSchema: Array.isArray(record.variablesSchema) ? record.variablesSchema as McpDefinition['variablesSchema'] : undefined,
    connectionTest: normalizeConnectionTest(record.connectionTest)
  };
}

function normalizePluginDefinition(value: unknown, fallbackExtensionId: string): {
  extensionId: string;
  version: string;
  installMode: string;
  packagePath?: string;
  expectedSha256?: string;
  operation?: string;
  manifest?: { actions?: Array<{ action: string; source?: string; target?: string; content?: string }> };
  manualInstructions?: string;
  manualInstructionsUrl?: string;
} {
  const record = assertRecord(value, undefined);
  const manifest = record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest)
    ? record.manifest as { actions?: Array<{ action: string; source?: string; target?: string; content?: string }> }
    : undefined;
  return {
    extensionId: stringValue(record.extensionId ?? record.extensionID, fallbackExtensionId),
    version: stringValue(record.version, '1.0.0'),
    installMode: stringValue(record.installMode, 'MANUAL_DOWNLOAD'),
    packagePath: stringValueOrUndefined(record.packagePath),
    expectedSha256: stringValueOrUndefined(record.expectedSha256 ?? record.packageSha256),
    operation: stringValueOrUndefined(record.operation),
    manifest,
    manualInstructions: stringValueOrUndefined(record.manualInstructions ?? record.manualInstallDoc),
    manualInstructionsUrl: stringValueOrUndefined(record.manualInstructionsUrl ?? record.manualInstallDocUrl ?? record.externalDownload)
  };
}

function normalizeConnectionTest(value: unknown): McpDefinition['connectionTest'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    type: stringValue(record.type, ''),
    command: stringValueOrUndefined(record.command),
    url: stringValueOrUndefined(record.url ?? record.target)
  };
}

function normalizePluginInstallMode(value: string, requestID?: string): PluginInstallMode {
  const normalized = value.toUpperCase().replaceAll('-', '_');
  if (normalized === 'MANAGED_PACKAGE' || normalized === 'CONFIG_PLUGIN' || normalized === 'MANUAL_DOWNLOAD') {
    return normalized;
  }
  throw new DesktopErrorException(makeDesktopError('validation_failed', 'installMode must be MANAGED_PACKAGE, CONFIG_PLUGIN, or MANUAL_DOWNLOAD', requestID));
}

function normalizeLocalKind(value: string | undefined, record: RecordPayload): 'skill' | 'mcp' | 'plugin' {
  const normalized = value?.toLowerCase();
  if (normalized === 'mcp' || normalized === 'plugin' || normalized === 'skill') return normalized;
  if ('configPath' in record || 'secureRef' in record) return 'mcp';
  if ('adapterId' in record || 'adapterID' in record) return 'plugin';
  return 'skill';
}

function normalizePluginOperation(value: string | undefined, requestID?: string): 'install' | 'enable' | 'disable' | 'update' | 'uninstall' | 'mark-installed' | 'mark-uninstalled' | undefined {
  if (!value) return undefined;
  if (['install', 'enable', 'disable', 'update', 'uninstall', 'mark-installed', 'mark-uninstalled'].includes(value)) {
    return value as 'install' | 'enable' | 'disable' | 'update' | 'uninstall' | 'mark-installed' | 'mark-uninstalled';
  }
  throw new DesktopErrorException(makeDesktopError('validation_failed', 'operation is not supported', requestID));
}

function normalizeSyncReason(value: string | undefined, requestID?: string): NetworkRecoverySyncInput['reason'] {
  if (!value) return 'manual';
  if (value === 'startup' || value === 'online-transition' || value === 'manual') return value;
  throw new DesktopErrorException(makeDesktopError('validation_failed', 'sync reason must be startup, online-transition, or manual', requestID));
}

function normalizeVariablesSchema(value: unknown): McpDefinition['variablesSchema'] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || record.name.length === 0) return [];
    return [{ name: record.name, sensitive: typeof record.sensitive === 'boolean' ? record.sensitive : undefined, required: typeof record.required === 'boolean' ? record.required : undefined }];
  });
}

function recordValue(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

function submissionPayload(record: RecordPayload, requestID?: string): RecordPayload {
  if (record.request !== undefined) return requiredRecord(record, 'request', requestID);
  const { idempotencyKey: _idempotencyKey, ...payload } = record;
  return payload;
}

function requiredExtensionId(record: RecordPayload, requestID?: string): string {
  const value = record.extensionId ?? record.extensionID;
  if (typeof value !== 'string' || value.length === 0) {
    throw new DesktopErrorException(makeDesktopError('validation_failed', 'extensionId is required', requestID));
  }
  return value;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function stringValueOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
