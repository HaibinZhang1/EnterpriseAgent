import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { requiredString, assertRecord, optionalString, optionalBoolean, optionalRecord, requiredRecord, type RecordPayload } from '../../shared/validation';
import { DesktopErrorException, makeDesktopError, type DesktopErrorCode } from '../../shared/errors';
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
import type { ExecutionPlan } from '../executor/types';
import { normalizeCustomAgentProfiles } from '../agents/agent-catalog';
import type { LocalLifecycleRepository } from '../lifecycle/local-lifecycle-repository';
import type { LocalInventoryScanner } from '../lifecycle/local-inventory-scanner';
import type { LocalKitService } from '../lifecycle/local-kit-service';
import type { ClientLogger } from '../logging/client-logger';
import type { McpDefinition, McpService } from '../mcp/mcp-service';
import type { PackageDownloadService } from '../packages/package-download-service';
import type { PluginInstallMode, PluginService } from '../plugin/plugin-service';
import type { SecureStore } from '../security/secure-store';
import type { SkillService } from '../skill/skill-service';
import type { AdapterRegistry } from '../tool-adapters/registry';
import type { AdapterCapability, ExtensionKind, ToolAdapter } from '../tool-adapters/types';
import type { ClientUpdateService } from '../update/client-update-service';
import { LocalResourceTypes, ResourceScopeTypes, type LocalResourceType, type ResourceScopeType } from '../../shared/local-resources';
import {
  createPhase3OperationPolicyDecision,
  isPhase3OperationPermitted,
  toPhase3ResourceContext,
  type OperationPolicyDecision,
  type Phase3PageSurface
} from '../../shared/local-phase3-operations';
import { IPC_CHANNELS } from './channels';
import { IpcRouter } from './ipc-router';
import { sanitizeLoginResult } from './sanitize';

const REMEMBERED_LOGIN_VERSION = 1;

interface RememberedLogin {
  version: number;
  username: string;
  password: string;
  autoLogin: boolean;
  updatedAt: string;
}

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
  localKitService: LocalKitService;
  mcpService: McpService;
  packageDownloadService: PackageDownloadService;
  pluginService: PluginService;
  skillService: SkillService;
  adapterRegistry: AdapterRegistry;
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
    const rememberPassword = optionalBoolean(record, 'rememberPassword', context.requestID) ?? false;
    const login = await loginDesktop(services, username, password, context.requestID);
    if (login.authenticated) {
      if (rememberPassword) {
        await saveRememberedLogin(services, username, password);
      } else {
        await services.secureStore.delete('auth.remembered-login');
      }
    }
    return login.result;
  });

  router.register(IPC_CHANNELS.authLogout, async (_payload, context) => {
    try {
      return await services.apiClient.logout(context.requestID);
    } finally {
      await services.secureStore.delete('session.token');
    }
  });

  router.register(IPC_CHANNELS.authGetSession, async () => (
    services.secureStore.getStartupSessionState
      ? services.secureStore.getStartupSessionState()
      : { hasSession: Boolean(await services.secureStore.get('session.token')) }
  ));
  router.register(IPC_CHANNELS.authGetRememberedLogin, async () => rememberedLoginSummary(await loadRememberedLogin(services)));
  router.register(IPC_CHANNELS.authClearRememberedLogin, async () => {
    await services.secureStore.delete('auth.remembered-login');
    return { remembered: false, autoLogin: false };
  });
  router.register(IPC_CHANNELS.authAutoLogin, async (_payload, context) => {
    const remembered = await loadRememberedLogin(services);
    if (!remembered?.autoLogin) {
      throw new DesktopErrorException(makeDesktopError('remembered_login_missing', 'No remembered login is available', context.requestID));
    }
    return (await loginDesktop(services, remembered.username, remembered.password, context.requestID)).result;
  });
  router.register(IPC_CHANNELS.authMe, (_payload, context) => services.apiClient.me(context.requestID));
  router.register(IPC_CHANNELS.authChangePassword, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const result = await services.apiClient.changePassword({
      oldPassword: requiredString(record, 'oldPassword', context.requestID),
      newPassword: requiredString(record, 'newPassword', context.requestID)
    }, context.requestID);
    await services.secureStore.delete('session.token');
    await services.secureStore.delete('auth.remembered-login');
    return result;
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
  router.register(IPC_CHANNELS.localListPendingEvents, () => services.eventQueue.listPending());
  router.register(IPC_CHANNELS.localScanInventory, () => services.localInventoryScanner.scan());
  router.register(IPC_CHANNELS.localListResources, () => services.lifecycleRepository.listResources());
  router.register(IPC_CHANNELS.localRunStaticAudit, (_payload, context) => services.lifecycleRepository.runStaticAuditForAllResources({ requestID: context.requestID }));
  router.register(IPC_CHANNELS.localPreviewFile, (payload, context) => {
    const record = assertRecord(payload ?? {}, context.requestID);
    return services.lifecycleRepository.previewResourceFile({
      resourceId: optionalString(record, 'resourceId', context.requestID),
      bindingId: optionalString(record, 'bindingId', context.requestID),
      targetPath: optionalString(record, 'targetPath', context.requestID),
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.localCheckPath, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.lifecycleRepository.checkResourcePath({
      resourceId: optionalString(record, 'resourceId', context.requestID),
      bindingId: optionalString(record, 'bindingId', context.requestID),
      targetPath: expandUserPath(optionalString(record, 'targetPath', context.requestID)),
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.localRemoveProjectRecord, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.lifecycleRepository.removeProjectManagementRecord({
      projectId: requiredString(record, 'projectId', context.requestID),
      requestID: context.requestID
    });
  });
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
  router.register(IPC_CHANNELS.kitImportManifest, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.importManifest({
      manifest: record.manifest ?? record.kitManifest ?? record,
      sourcePath: expandUserPath(optionalString(record, 'sourcePath', context.requestID)),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitExportManifest, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.exportManifest({
      kitId: requiredString(record, 'kitId', context.requestID),
      targetPath: expandUserPath(optionalString(record, 'targetPath', context.requestID)),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitGenerateFromAgent, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.generateFromAgent({
      agentId: requiredString(record, 'agentId', context.requestID),
      kitId: requiredString(record, 'kitId', context.requestID),
      name: requiredString(record, 'name', context.requestID),
      version: optionalString(record, 'version', context.requestID),
      description: optionalString(record, 'description', context.requestID),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitGenerateFromProject, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.generateFromProject({
      projectId: requiredString(record, 'projectId', context.requestID),
      kitId: requiredString(record, 'kitId', context.requestID),
      name: requiredString(record, 'name', context.requestID),
      version: optionalString(record, 'version', context.requestID),
      description: optionalString(record, 'description', context.requestID),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitApply, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const targetRecord = optionalRecord(record, 'target', context.requestID) ?? record;
    return services.localKitService.apply({
      kitId: optionalString(record, 'kitId', context.requestID),
      manifest: record.manifest,
      applicationId: optionalString(record, 'applicationId', context.requestID),
      target: kitTargetPayload(targetRecord, context.requestID),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitRemoveApplication, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.removeApplication({
      kitId: requiredString(record, 'kitId', context.requestID),
      applicationId: optionalString(record, 'applicationId', context.requestID),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitDeleteManifest, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.deleteManifest({
      kitId: requiredString(record, 'kitId', context.requestID),
      removeApplications: optionalBoolean(record, 'removeApplications', context.requestID) ?? false,
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitCheckDrift, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.checkDrift({
      kitId: requiredString(record, 'kitId', context.requestID),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.kitStaticAudit, (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    return services.localKitService.runStaticAudit({
      kitId: requiredString(record, 'kitId', context.requestID),
      dryRun: optionalBoolean(record, 'dryRun', context.requestID) ?? false,
      requestID: context.requestID
    });
  });
  router.register(IPC_CHANNELS.localCleanup, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredExtensionId(record, context.requestID);
    const target = expandUserPath(optionalString(record, 'target', context.requestID) ?? optionalString(record, 'configPath', context.requestID));
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
    const result = await executePlan(services, plan, [services.paths.root, target], [target]);
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
    const saved: Record<string, unknown> = { ...current, ...next, updatedAt: new Date().toISOString() };
    await writeFile(services.paths.configFile, `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
    if (typeof saved.baseURL === 'string' && saved.baseURL) {
      services.apiClient.setBaseURL(saved.baseURL);
    }
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
    const targetPath = expandUserPath(requiredString(record, 'targetPath', context.requestID));
    const dryRun = optionalBoolean(record, 'dryRun', context.requestID) ?? true;
    const phase3Policy = await assertPhase3IpcPolicyAllowed(services, {
      surface: 'extensions',
      operation: 'skill.install',
      extensionId,
      resourceType: LocalResourceTypes.SKILL,
      requestID: context.requestID
    });
    const adapter = selectAdapter(services, {
      extensionKind: 'skill',
      adapterId: optionalString(record, 'adapterId', context.requestID),
      requiredCapabilities: ['controlled-install', 'symlink'],
      requestID: context.requestID
    });
    const decision = services.offlinePolicy.decide('extension.install', true, context.requestID);
    if (!decision.allowed) {
      throw new DesktopErrorException(decision.error ?? makeDesktopError('offline_server_authority_required', decision.reason, context.requestID));
    }
    const detail = normalizeExtensionDetail(await services.apiClient.extensionDetail(extensionId, context.requestID), extensionId, version);
    const packageInfo = dryRun
      ? { packagePath: path.join(services.paths.tempDir, `${extensionId}-${version}.package`), expectedSha256: detail.packageSha256 }
      : await downloadExtensionPackage(services, { extensionId, version, purpose: 'INSTALL', expectedSha256: detail.packageSha256, requestID: context.requestID });
    const installPlan = services.skillService.createInstallPlan({ extensionId, version, targetPath, packagePath: packageInfo.packagePath, expectedSha256: packageInfo.expectedSha256, dryRun, requestID: context.requestID });
    const installResult = await executePlan(services, installPlan, [services.paths.root]);
    const plan = services.skillService.createEnablePlan({ extensionId, version, targetPath, dryRun, requestID: context.requestID });
    const result = installResult.status === 'success' || installResult.status === 'dry_run'
      ? await executePlan(services, plan, [services.paths.root, targetPath], [targetPath])
      : installResult;
    if (!dryRun && result.status === 'success') {
      await services.lifecycleRepository.recordSkillInstalled({ extensionId, version, packageSha256: packageInfo.expectedSha256, name: detail.name, summary: detail.summary });
      await services.lifecycleRepository.recordTarget({ extensionId, target: targetPath, status: 'enabled', metadata: { version, adapterId: adapter.manifest.adapterId } });
    }
    return { policy: phase3Policy, adapter: adapter.manifest, packageInfo, installPlan, installResult, plan, result };
  });

  router.register(IPC_CHANNELS.mcpConfigure, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredString(record, 'extensionID', context.requestID);
    const targetConfigPath = expandUserPath(requiredString(record, 'targetConfigPath', context.requestID));
    const variables = stringMap(optionalRecord(record, 'variables', context.requestID) ?? {}, context.requestID);
    const dryRun = optionalBoolean(record, 'dryRun', context.requestID) ?? true;
    const phase3Policy = await assertPhase3IpcPolicyAllowed(services, {
      surface: 'extensions',
      operation: 'mcp.configure',
      extensionId,
      resourceType: LocalResourceTypes.MCP_SERVER,
      requestID: context.requestID
    });
    const adapter = selectAdapter(services, {
      extensionKind: 'mcp',
      adapterId: optionalString(record, 'adapterId', context.requestID),
      requiredCapabilities: ['config-write'],
      requestID: context.requestID
    });
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
    const result = await executePlan(services, output.plan, [services.paths.root, targetConfigPath], [targetConfigPath]);
    const connectionTest = !dryRun && result.status === 'success' && definition.connectionTest
      ? await services.mcpService.executeConnectionTest(definition.connectionTest, {
        requestID: context.requestID,
        extensionId,
        version: definition.version,
        deviceID: (await services.getDeviceInfo()).deviceID,
        eventQueue: services.eventQueue
      })
      : undefined;
    const rollbackPlan = !dryRun && result.status === 'success' && connectionTest && connectionTest.status !== 'reachable'
      ? services.mcpService.createUninstallPlan({ definition, targetConfigPath, dryRun: false, requestID: context.requestID })
      : undefined;
    const rollbackResult = rollbackPlan
      ? await executePlan(services, rollbackPlan, [services.paths.root, targetConfigPath], [targetConfigPath])
      : undefined;
    if (!dryRun && result.status === 'success') {
      await services.lifecycleRepository.recordMcpInstallation({
        extensionId,
        target: targetConfigPath,
        status: connectionTest && connectionTest.status !== 'reachable' ? 'connection_test_failed' : 'connected',
        configPath: targetConfigPath,
        secureRef: output.fullConfigRef,
        metadata: { version: definition.version, adapterId: adapter.manifest.adapterId, managedConfigId: output.managedConfigId, secretRefs: output.secretRefs, variableChanges: output.variableChanges, variablesSchema: definition.variablesSchema, operation: output.plan.operation, connectionTest, rollbackResult }
      });
    }
    return { policy: phase3Policy, adapter: adapter.manifest, definition, redactedPreview: output.redactedPreview, variableChanges: output.variableChanges, managedConfigId: output.managedConfigId, fullConfigRef: output.fullConfigRef, plan: output.plan, result, connectionTest, rollbackPlan, rollbackResult };
  });

  router.register(IPC_CHANNELS.mcpConnectionTest, async (payload, context) => {
    const record = assertRecord(payload, context.requestID);
    const extensionId = requiredString(record, 'extensionID', context.requestID);
    const definition = normalizeMcpDefinition(await services.apiClient.getMcpDefinition(extensionId, context.requestID), extensionId);
    await assertPhase3IpcPolicyAllowed(services, {
      surface: 'extensions',
      operation: 'mcp.connection-test',
      extensionId,
      resourceType: LocalResourceTypes.MCP_SERVER,
      requestID: context.requestID,
      metadata: { connectionTestType: definition.connectionTest?.type, transport: definition.connectionTest?.type }
    });
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
    const targetPath = expandUserPath(requiredString(record, 'targetPath', context.requestID));
    const installMode = normalizePluginInstallMode(optionalString(record, 'installMode', context.requestID) ?? definition.installMode, context.requestID);
    const dryRun = optionalBoolean(record, 'dryRun', context.requestID) ?? true;
    const operation = normalizePluginOperation(optionalString(record, 'operation', context.requestID), context.requestID);
    const phase3Policy = await assertPhase3IpcPolicyAllowed(services, {
      surface: 'extensions',
      operation: phase3PluginOperation(installMode, operation),
      extensionId,
      resourceType: LocalResourceTypes.PLUGIN,
      requestID: context.requestID
    });
    const adapter = selectAdapter(services, {
      extensionKind: 'plugin',
      adapterId: optionalString(record, 'adapterId', context.requestID),
      requiredCapabilities: installMode === 'CONFIG_PLUGIN' ? ['config-write'] : ['controlled-install'],
      requestID: context.requestID
    });
    const decision = services.offlinePolicy.decide('plugin.install', true, context.requestID);
    if (!decision.allowed) {
      throw new DesktopErrorException(decision.error ?? makeDesktopError('offline_server_authority_required', decision.reason, context.requestID));
    }
    const shouldDownload = !dryRun && installMode !== 'CONFIG_PLUGIN' && !['enable', 'disable', 'uninstall', 'mark-installed', 'mark-uninstalled'].includes(operation ?? '');
    const downloaded = shouldDownload
      ? await downloadExtensionPackage(services, {
        extensionId,
        version: definition.version,
        purpose: installMode === 'MANUAL_DOWNLOAD' ? 'MANUAL_DOWNLOAD' : operation === 'update' ? 'UPDATE' : 'INSTALL',
        expectedSha256: definition.expectedSha256,
        requestID: context.requestID
      })
      : undefined;
    const plan = services.pluginService.createPlan({
      extensionId,
      version: definition.version,
      installMode,
      targetPath,
      packagePath: downloaded?.packagePath ?? optionalString(record, 'packagePath', context.requestID) ?? definition.packagePath,
      expectedSha256: downloaded?.expectedSha256 ?? definition.expectedSha256,
      operation,
      manifest: definition.manifest,
      manualInstructions: definition.manualInstructions,
      manualInstructionsUrl: definition.manualInstructionsUrl,
      dryRun,
      requestID: context.requestID
    });
    const result = await executePlan(services, plan, [services.paths.root, targetPath], [targetPath]);
    if (!dryRun && result.status === 'success') {
      await services.lifecycleRepository.recordPluginInstallation({
        extensionId,
        target: targetPath,
        status: pluginLifecycleStatus(installMode, operation),
        adapterId: adapter.manifest.adapterId,
        metadata: { version: definition.version, installMode, operation: plan.operation, downloadedPackagePath: downloaded?.packagePath, expectedSha256: downloaded?.expectedSha256 }
      });
    }
    return { policy: phase3Policy, adapter: adapter.manifest, definition, download: downloaded, plan, result };
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

async function loginDesktop(services: DesktopIpcServices, username: string, password: string, requestID?: string): Promise<{ result: unknown; authenticated: boolean }> {
  const device = await services.getDeviceInfo();
  const result = await services.apiClient.login({
    phone: username,
    password,
    clientType: 'DESKTOP',
    deviceId: device.deviceID,
    clientVersion: device.clientVersion
  }, requestID);
  const authenticated = hasLoginToken(result);
  if (authenticated) {
    await services.secureStore.set('session.token', result.token);
    await services.deviceRegistrationService.register(requestID);
    await services.clientUpdateService.reportStartupVersion(requestID).catch((error) => {
      void services.logger.warn('client_update.startup_report_failed', error, requestID);
    });
  }
  return { result: sanitizeLoginResult(result), authenticated };
}

function hasLoginToken(result: unknown): result is { token: string } {
  return typeof result === 'object' && result !== null && 'token' in result && typeof result.token === 'string';
}

async function saveRememberedLogin(services: DesktopIpcServices, username: string, password: string): Promise<void> {
  const remembered: RememberedLogin = {
    version: REMEMBERED_LOGIN_VERSION,
    username,
    password,
    autoLogin: true,
    updatedAt: new Date().toISOString()
  };
  await services.secureStore.set('auth.remembered-login', JSON.stringify(remembered));
}

async function loadRememberedLogin(services: DesktopIpcServices): Promise<RememberedLogin | undefined> {
  const raw = await services.secureStore.get('auth.remembered-login');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (
      parsed.version === REMEMBERED_LOGIN_VERSION
      && typeof parsed.username === 'string'
      && parsed.username
      && typeof parsed.password === 'string'
      && parsed.password
    ) {
      return {
        version: REMEMBERED_LOGIN_VERSION,
        username: parsed.username,
        password: parsed.password,
        autoLogin: parsed.autoLogin === true,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function rememberedLoginSummary(remembered: RememberedLogin | undefined): { remembered: boolean; username?: string; autoLogin: boolean; updatedAt?: string } {
  if (!remembered) return { remembered: false, autoLogin: false };
  return {
    remembered: true,
    username: remembered.username,
    autoLogin: remembered.autoLogin,
    updatedAt: remembered.updatedAt || undefined
  };
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
    } else if (key === 'agentProfiles') {
      const validation = normalizeCustomAgentProfiles(value);
      if (!validation.valid) {
        throw new DesktopErrorException(makeDesktopError('validation_failed', validation.errors.join('; '), requestID));
      }
      output[key] = validation.normalized;
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
  manifest?: { actions?: Array<{ action: string; source?: string; target?: string; content?: string; expectedSha256?: string }> };
  manualInstructions?: string;
  manualInstructionsUrl?: string;
} {
  const record = assertRecord(value, undefined);
  const manifest = record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest)
    ? record.manifest as { actions?: Array<{ action: string; source?: string; target?: string; content?: string; expectedSha256?: string }> }
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

async function executePlan(services: DesktopIpcServices, plan: ExecutionPlan, allowedRoots: string[], managedPaths: string[] = []) {
  return services.localExecutor.execute(plan, {
    allowedRoots: uniquePaths(allowedRoots),
    managedPaths: uniquePaths(managedPaths),
    backupRoot: services.paths.backupsDir,
    db: services.db,
    eventQueue: services.eventQueue,
    deviceID: (await services.getDeviceInfo()).deviceID
  });
}

async function assertPhase3IpcPolicyAllowed(
  services: DesktopIpcServices,
  input: {
    surface: Phase3PageSurface;
    operation: string;
    extensionId: string;
    resourceType: LocalResourceType;
    requestID?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<OperationPolicyDecision> {
  const resources = phase3ResourcesForExtension(services, input);
  const decision = createPhase3OperationPolicyDecision({
    surface: input.surface,
    operation: input.operation,
    resources,
    metadata: input.metadata
  });
  if (isPhase3OperationPermitted(decision) && decision.status !== 'read_only') return decision;

  await enqueuePhase3PolicyBlockedEvent(services, input, decision, resources[0]);
  throw new DesktopErrorException(makeDesktopError(
    desktopErrorCodeForPolicy(decision),
    decision.reason ?? 'Operation is not allowed by local phase-three policy',
    input.requestID,
    { operation: input.operation, decision }
  ));
}

function phase3ResourcesForExtension(
  services: DesktopIpcServices,
  input: { extensionId: string; resourceType: LocalResourceType; metadata?: Record<string, unknown> }
) {
  const snapshot = services.lifecycleRepository.listResources();
  const rows = snapshot.rows.filter((row) => row.resource.type === input.resourceType && row.resource.sourceId === input.extensionId);
  if (rows.length === 0) {
    return [{
      sourceId: input.extensionId,
      name: input.extensionId,
      resourceType: input.resourceType,
      metadata: input.metadata ?? {}
    }];
  }
  return rows.map((row) => toPhase3ResourceContext({
    resource: row.resource,
    binding: row.binding,
    metadata: input.metadata
  }));
}

async function enqueuePhase3PolicyBlockedEvent(
  services: DesktopIpcServices,
  input: { operation: string; extensionId: string; resourceType: LocalResourceType; requestID?: string },
  decision: OperationPolicyDecision,
  firstResource: ReturnType<typeof phase3ResourcesForExtension>[number] | undefined
): Promise<void> {
  const device = await services.getDeviceInfo();
  await services.eventQueue.enqueue({
    idempotencyKey: `phase3-policy:${input.requestID ?? 'unknown'}:${input.operation}:${input.extensionId}`,
    deviceID: device.deviceID,
    extensionID: input.extensionId,
    eventType: 'PHASE3_OPERATION_BLOCKED',
    operationID: input.operation,
    resourceID: firstResource?.resourceId,
    bindingID: firstResource?.bindingId,
    resourceType: input.resourceType,
    agentID: firstResource?.agentId,
    projectID: firstResource?.projectId,
    kitID: firstResource?.kitId,
    result: 'FAILURE',
    errorCode: decision.checks.find((check) => check.status === 'block')?.errorCode ?? decision.status,
    failureReason: decision.reason,
    suggestion: decision.suggestion,
    offlineCreated: true,
    payload: { decision }
  });
}

function desktopErrorCodeForPolicy(decision: OperationPolicyDecision): DesktopErrorCode {
  const errorCode = decision.checks.find((check) => check.status === 'block')?.errorCode;
  if (errorCode === 'hash_mismatch') return 'hash_mismatch';
  if (errorCode === 'target_path_not_found') return 'target_path_not_found';
  if (errorCode === 'invalid_execution_plan') return 'invalid_execution_plan';
  if (errorCode === 'offline_server_authority_required') return 'offline_server_authority_required';
  if (errorCode === 'security_delisted') return 'permission_denied';
  return decision.status === 'disabled' ? 'invalid_execution_plan' : 'scope_restricted';
}

function phase3PluginOperation(installMode: PluginInstallMode, operation: ReturnType<typeof normalizePluginOperation>): string {
  if (operation === 'uninstall' || operation === 'mark-uninstalled') return 'plugin.uninstall';
  if (operation === 'disable') return 'plugin.disable';
  if (operation === 'enable' || operation === 'mark-installed') return 'plugin.enable';
  if (operation === 'update') return 'plugin.update';
  if (installMode === 'MANUAL_DOWNLOAD') return 'plugin.download';
  return 'plugin.install';
}

function kitTargetPayload(record: RecordPayload, requestID?: string): {
  scopeType?: ResourceScopeType;
  agentId?: string;
  projectId?: string;
  scopePath?: string;
  targetPath?: string;
} {
  const scopeType = optionalString(record, 'scopeType', requestID);
  return {
    scopeType: scopeType ? requireResourceScopeType(scopeType, requestID) : undefined,
    agentId: optionalString(record, 'agentId', requestID),
    projectId: optionalString(record, 'projectId', requestID),
    scopePath: expandUserPath(optionalString(record, 'scopePath', requestID)),
    targetPath: expandUserPath(optionalString(record, 'targetPath', requestID))
  };
}

function requireResourceScopeType(value: string, requestID?: string): ResourceScopeType {
  if (Object.values(ResourceScopeTypes).includes(value as ResourceScopeType)) return value as ResourceScopeType;
  throw new DesktopErrorException(makeDesktopError('validation_failed', `Invalid Kit target scopeType: ${value}`, requestID));
}

async function downloadExtensionPackage(
  services: DesktopIpcServices,
  input: {
    extensionId: string;
    version: string;
    purpose: 'INSTALL' | 'UPDATE' | 'MANUAL_DOWNLOAD';
    expectedSha256?: string;
    requestID?: string;
  }
): Promise<{ packagePath: string; expectedSha256?: string; fileName: string }> {
  const idempotencyKey = `download:${input.extensionId}:${input.version}:${input.purpose}`;
  const ticket = await services.apiClient.createDownloadTicket({
    extensionID: input.extensionId,
    version: input.version,
    purpose: input.purpose,
    objectType: input.purpose === 'MANUAL_DOWNLOAD' ? 'EXTERNAL_PLUGIN_FILE' : 'EXTENSION_PACKAGE'
  }, input.requestID, idempotencyKey);
  if (!ticket.ticket) {
    throw new DesktopErrorException(makeDesktopError('download_ticket_required', 'Server did not return a download ticket', input.requestID));
  }
  const expectedSha256 = ticket.sha256 ?? ticket.packageSha256 ?? input.expectedSha256;
  const fileName = ticket.fileName ?? `${input.extensionId}-${input.version}.pkg`;
  const packagePath = await services.packageDownloadService.downloadAndVerify({
    ticket: ticket.ticket,
    fileName,
    expectedSha256,
    requestID: input.requestID
  });
  return { packagePath, expectedSha256, fileName };
}

function selectAdapter(
  services: DesktopIpcServices,
  input: { extensionKind: ExtensionKind; adapterId?: string; requiredCapabilities: AdapterCapability[]; requestID?: string }
): ToolAdapter {
  const matches = services.adapterRegistry.match({
    extensionKind: input.extensionKind,
    requiredCapabilities: input.requiredCapabilities,
    platform: process.platform
  });
  const selected = input.adapterId ? matches.find((adapter) => adapter.manifest.adapterId === input.adapterId) : matches[0];
  if (!selected) {
    throw new DesktopErrorException(makeDesktopError('tool_not_detected', services.adapterRegistry.explainNoMatch({
      extensionKind: input.extensionKind,
      requiredCapabilities: input.requiredCapabilities,
      platform: process.platform
    }), input.requestID, { adapterId: input.adapterId }));
  }
  return selected;
}

function normalizeExtensionDetail(value: unknown, fallbackExtensionId: string, fallbackVersion: string): { name?: string; summary?: string; packageSha256?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const packageSha256 = stringValueOrUndefined(record.packageSha256 ?? record.sha256 ?? record.hash);
  return {
    name: stringValueOrUndefined(record.name ?? record.displayName ?? record.extensionName) ?? fallbackExtensionId,
    summary: stringValueOrUndefined(record.summary ?? record.description),
    packageSha256: packageSha256 ?? stringValueOrUndefined(record[`${fallbackVersion}:sha256`])
  };
}

function pluginLifecycleStatus(installMode: PluginInstallMode, operation: ReturnType<typeof normalizePluginOperation>): string {
  if (operation === 'enable') return 'enabled';
  if (operation === 'disable') return 'disabled';
  if (operation === 'update') return 'updated';
  if (operation === 'mark-installed') return 'installed';
  if (operation === 'mark-uninstalled') return 'manual_uninstalled';
  if (operation === 'uninstall') return 'uninstalled';
  if (installMode === 'MANUAL_DOWNLOAD') return 'downloaded';
  if (installMode === 'CONFIG_PLUGIN') return 'configured';
  return 'installed';
}

function expandUserPath(value: string): string;
function expandUserPath(value: string | undefined): string | undefined;
function expandUserPath(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean).map((item) => path.resolve(item)))];
}
