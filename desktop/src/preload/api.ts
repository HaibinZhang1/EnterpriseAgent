import type { IpcResult } from '../shared/ipc';
import { IPC_CHANNELS, type IpcChannel } from '../main/ipc/channels';

export type PreloadInvoke = <T>(channel: IpcChannel, payload?: unknown, requestID?: string) => Promise<IpcResult<T>>;

export function createPreloadApi(invoke: PreloadInvoke) {
  return {
    auth: {
      login: (username: string, password: string, options?: { rememberPassword?: boolean }, requestID?: string) => invoke(IPC_CHANNELS.authLogin, { username, password, rememberPassword: options?.rememberPassword }, requestID),
      logout: (requestID?: string) => invoke(IPC_CHANNELS.authLogout, undefined, requestID),
      getSession: (requestID?: string) => invoke(IPC_CHANNELS.authGetSession, undefined, requestID),
      getRememberedLogin: (requestID?: string) => invoke(IPC_CHANNELS.authGetRememberedLogin, undefined, requestID),
      clearRememberedLogin: (requestID?: string) => invoke(IPC_CHANNELS.authClearRememberedLogin, undefined, requestID),
      autoLogin: (requestID?: string) => invoke(IPC_CHANNELS.authAutoLogin, undefined, requestID),
      me: (requestID?: string) => invoke(IPC_CHANNELS.authMe, undefined, requestID),
      changePassword: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.authChangePassword, payload, requestID),
      completeResetPassword: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.authCompleteResetPassword, payload, requestID)
    },
    catalog: {
      home: (requestID?: string) => invoke(IPC_CHANNELS.catalogHome, undefined, requestID),
      search: (q: string, requestID?: string) => invoke(IPC_CHANNELS.catalogSearch, { q }, requestID)
    },
    extension: {
      getDetail: (extensionID: string, requestID?: string) => invoke(IPC_CHANNELS.extensionGetDetail, { extensionID }, requestID),
      getVersions: (extensionID: string, requestID?: string) => invoke(IPC_CHANNELS.extensionGetVersions, { extensionID }, requestID),
      setStar: (extensionID: string, starred: boolean, requestID?: string) => invoke(IPC_CHANNELS.extensionSetStar, { extensionID, starred }, requestID),
      getMcpDefinition: (extensionID: string, requestID?: string) => invoke(IPC_CHANNELS.extensionGetMcpDefinition, { extensionID }, requestID),
      getPluginDefinition: (extensionID: string, requestID?: string) => invoke(IPC_CHANNELS.extensionGetPluginDefinition, { extensionID }, requestID),
      install: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.extensionInstall, payload, requestID)
    },
    device: {
      getInfo: (requestID?: string) => invoke(IPC_CHANNELS.deviceGetInfo, undefined, requestID)
    },
    local: {
      getStatus: (requestID?: string) => invoke(IPC_CHANNELS.localGetStatus, undefined, requestID),
      getOfflineState: (requestID?: string) => invoke(IPC_CHANNELS.localGetOfflineState, undefined, requestID),
      listPendingEvents: (requestID?: string) => invoke(IPC_CHANNELS.localListPendingEvents, undefined, requestID),
      listLifecycle: (requestID?: string) => invoke(IPC_CHANNELS.localListLifecycle, undefined, requestID),
      listResources: (requestID?: string) => invoke(IPC_CHANNELS.localListResources, undefined, requestID),
      scanInventory: (requestID?: string) => invoke(IPC_CHANNELS.localScanInventory, undefined, requestID),
      runStaticAudit: (requestID?: string) => invoke(IPC_CHANNELS.localRunStaticAudit, undefined, requestID),
      previewFile: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.localPreviewFile, payload, requestID),
      checkPath: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.localCheckPath, payload, requestID),
      removeProjectRecord: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.localRemoveProjectRecord, payload, requestID),
      cleanup: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.localCleanup, payload, requestID),
      syncPending: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.localSyncPending, payload, requestID)
    },
    kit: {
      importManifest: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitImportManifest, payload, requestID),
      exportManifest: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitExportManifest, payload, requestID),
      generateFromAgent: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitGenerateFromAgent, payload, requestID),
      generateFromProject: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitGenerateFromProject, payload, requestID),
      apply: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitApply, payload, requestID),
      removeApplication: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitRemoveApplication, payload, requestID),
      checkDrift: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitCheckDrift, payload, requestID),
      staticAudit: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.kitStaticAudit, payload, requestID)
    },
    settings: {
      getLocalConfig: (requestID?: string) => invoke(IPC_CHANNELS.settingsGetLocalConfig, undefined, requestID),
      saveLocalConfig: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.settingsSaveLocalConfig, payload, requestID)
    },
    logs: {
      getRecent: (requestID?: string) => invoke(IPC_CHANNELS.logsGetRecent, undefined, requestID)
    },
    mcp: {
      configure: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.mcpConfigure, payload, requestID),
      connectionTest: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.mcpConnectionTest, payload, requestID)
    },
    plugin: {
      prepare: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.pluginPrepare, payload, requestID)
    },
    publish: {
      uploadPackage: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.publishUploadPackage, payload, requestID),
      createSubmission: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.publishCreateSubmission, payload, requestID),
      listMine: (requestID?: string) => invoke(IPC_CHANNELS.publishListMine, undefined, requestID),
      getSubmission: (submissionID: string, requestID?: string) => invoke(IPC_CHANNELS.publishGetSubmission, { submissionID }, requestID),
      withdraw: (submissionID: string, requestID?: string) => invoke(IPC_CHANNELS.publishWithdraw, { submissionID }, requestID),
      resubmit: (submissionID: string, payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.publishResubmit, { submissionID, payload }, requestID)
    },
    notifications: {
      list: (requestID?: string) => invoke(IPC_CHANNELS.notificationsList, undefined, requestID),
      markRead: (notificationID: string, requestID?: string) => invoke(IPC_CHANNELS.notificationsRead, { notificationID }, requestID)
    },
    clientUpdate: {
      check: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateCheck, undefined, requestID),
      getPending: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateGetPending, undefined, requestID),
      confirmDownload: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateConfirmDownload, undefined, requestID),
      cancel: (reason?: string, requestID?: string) => invoke(IPC_CHANNELS.clientUpdateCancel, reason ? { reason } : undefined, requestID),
      confirmInstall: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateConfirmInstall, undefined, requestID)
    },
    startup: {
      getStatus: (requestID?: string) => invoke(IPC_CHANNELS.startupGetStatus, undefined, requestID),
      clearSession: (requestID?: string) => invoke(IPC_CHANNELS.startupClearSession, undefined, requestID),
      rebuildLocalDatabase: (requestID?: string) => invoke(IPC_CHANNELS.startupRebuildLocalDatabase, undefined, requestID),
      retry: (requestID?: string) => invoke(IPC_CHANNELS.startupRetry, undefined, requestID)
    }
  };
}

export type EnterpriseAgentPreloadApi = ReturnType<typeof createPreloadApi>;
