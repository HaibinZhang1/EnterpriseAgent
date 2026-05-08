export const IPC_CHANNELS = {
  authLogin: 'auth.login',
  authLogout: 'auth.logout',
  authGetSession: 'auth.getSession',
  catalogHome: 'catalog.home',
  catalogSearch: 'catalog.search',
  extensionGetDetail: 'extension.getDetail',
  extensionGetVersions: 'extension.getVersions',
  deviceGetInfo: 'device.getInfo',
  localGetStatus: 'local.getStatus',
  localGetOfflineState: 'local.getOfflineState',
  localEnqueueEvent: 'local.enqueueEvent',
  localListPendingEvents: 'local.listPendingEvents',
  settingsGetLocalConfig: 'settings.getLocalConfig',
  logsGetRecent: 'logs.getRecent',
  extensionInstall: 'extension.install'
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
export const ALLOWED_IPC_CHANNELS = Object.values(IPC_CHANNELS);
