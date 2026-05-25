import type { IpcResult } from '../shared/ipc';
import { IPC_CHANNELS, type IpcChannel } from '../main/ipc/channels';

export type PreloadInvoke = <T>(channel: IpcChannel, payload?: unknown, requestID?: string) => Promise<IpcResult<T>>;

export function createPreloadApi(invoke: PreloadInvoke) {
  return {
    auth: {
      login: (username: string, password: string, requestID?: string) => invoke(IPC_CHANNELS.authLogin, { username, password }, requestID),
      logout: (requestID?: string) => invoke(IPC_CHANNELS.authLogout, undefined, requestID),
      getSession: (requestID?: string) => invoke(IPC_CHANNELS.authGetSession, undefined, requestID)
    },
    catalog: {
      home: (requestID?: string) => invoke(IPC_CHANNELS.catalogHome, undefined, requestID),
      search: (q: string, requestID?: string) => invoke(IPC_CHANNELS.catalogSearch, { q }, requestID)
    },
    extension: {
      getDetail: (extensionID: string, requestID?: string) => invoke(IPC_CHANNELS.extensionGetDetail, { extensionID }, requestID),
      getVersions: (extensionID: string, requestID?: string) => invoke(IPC_CHANNELS.extensionGetVersions, { extensionID }, requestID)
    },
    device: {
      getInfo: (requestID?: string) => invoke(IPC_CHANNELS.deviceGetInfo, undefined, requestID)
    },
    local: {
      getStatus: (requestID?: string) => invoke(IPC_CHANNELS.localGetStatus, undefined, requestID),
      getOfflineState: (requestID?: string) => invoke(IPC_CHANNELS.localGetOfflineState, undefined, requestID),
      enqueueEvent: (payload: unknown, requestID?: string) => invoke(IPC_CHANNELS.localEnqueueEvent, payload, requestID),
      listPendingEvents: (requestID?: string) => invoke(IPC_CHANNELS.localListPendingEvents, undefined, requestID)
    },
    settings: {
      getLocalConfig: (requestID?: string) => invoke(IPC_CHANNELS.settingsGetLocalConfig, undefined, requestID)
    },
    logs: {
      getRecent: (requestID?: string) => invoke(IPC_CHANNELS.logsGetRecent, undefined, requestID)
    },
    clientUpdate: {
      check: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateCheck, undefined, requestID),
      getPending: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateGetPending, undefined, requestID),
      confirmDownload: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateConfirmDownload, undefined, requestID),
      cancel: (reason?: string, requestID?: string) => invoke(IPC_CHANNELS.clientUpdateCancel, reason ? { reason } : undefined, requestID),
      confirmInstall: (requestID?: string) => invoke(IPC_CHANNELS.clientUpdateConfirmInstall, undefined, requestID)
    }
  };
}

export type EnterpriseAgentPreloadApi = ReturnType<typeof createPreloadApi>;
