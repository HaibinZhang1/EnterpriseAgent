import { unwrapResult } from './errors';
import { createRequestId } from './requestId';

export const desktopApi = {
  auth: {
    getSession: () => call('session', window.enterpriseAgent.auth.getSession()),
    login: (username: string, password: string, rememberPassword = false) => call('login', window.enterpriseAgent.auth.login(username, password, { rememberPassword }, createRequestId('login'))),
    logout: () => call('logout', window.enterpriseAgent.auth.logout(createRequestId('logout'))),
    getRememberedLogin: () => call('rememberedLogin', window.enterpriseAgent.auth.getRememberedLogin(createRequestId('rememberedLogin'))),
    clearRememberedLogin: () => call('clearRememberedLogin', window.enterpriseAgent.auth.clearRememberedLogin(createRequestId('clearRememberedLogin'))),
    autoLogin: () => call('autoLogin', window.enterpriseAgent.auth.autoLogin(createRequestId('autoLogin'))),
    me: () => call('me', window.enterpriseAgent.auth.me(createRequestId('me'))),
    changePassword: (payload: { oldPassword: string; newPassword: string }) => call('password', window.enterpriseAgent.auth.changePassword(payload, createRequestId('password'))),
    completeResetPassword: (payload: { resetToken: string; newPassword: string }) => call('resetPassword', window.enterpriseAgent.auth.completeResetPassword(payload, createRequestId('resetPassword')))
  },
  catalog: {
    home: () => call('communityHome', window.enterpriseAgent.catalog.home(createRequestId('communityHome'))),
    search: (q: string) => call('search', window.enterpriseAgent.catalog.search(q, createRequestId('search')))
  },
  extension: {
    detail: (extensionID: string) => call('detail', window.enterpriseAgent.extension.getDetail(extensionID, createRequestId('detail'))),
    versions: (extensionID: string) => call('versions', window.enterpriseAgent.extension.getVersions(extensionID, createRequestId('versions'))),
    setStar: (extensionID: string, starred: boolean) => call('star', window.enterpriseAgent.extension.setStar(extensionID, starred, createRequestId('star'))),
    install: (payload: unknown) => call('skillInstall', window.enterpriseAgent.extension.install(payload, createRequestId('skillInstall')))
  },
  local: {
    status: () => call('localStatus', window.enterpriseAgent.local.getStatus(createRequestId('localStatus'))),
    offline: () => call('offline', window.enterpriseAgent.local.getOfflineState(createRequestId('offline'))),
    events: () => call('events', window.enterpriseAgent.local.listPendingEvents(createRequestId('events'))),
    lifecycle: () => call('lifecycle', window.enterpriseAgent.local.listLifecycle(createRequestId('lifecycle'))),
    scanInventory: () => call('localScan', window.enterpriseAgent.local.scanInventory(createRequestId('localScan'))),
    cleanup: (payload: unknown) => call('cleanup', window.enterpriseAgent.local.cleanup(payload, createRequestId('cleanup'))),
    syncPending: (payload: unknown) => call('syncPending', window.enterpriseAgent.local.syncPending(payload, createRequestId('syncPending')))
  },
  device: {
    info: () => call('device', window.enterpriseAgent.device.getInfo(createRequestId('device')))
  },
  settings: {
    get: () => call('settings', window.enterpriseAgent.settings.getLocalConfig(createRequestId('settings'))),
    save: (payload: unknown) => call('saveSettings', window.enterpriseAgent.settings.saveLocalConfig(payload, createRequestId('saveSettings')))
  },
  mcp: {
    configure: (payload: unknown) => call('mcpConfigure', window.enterpriseAgent.mcp.configure(payload, createRequestId('mcpConfigure'))),
    connectionTest: (payload: unknown) => call('mcpTest', window.enterpriseAgent.mcp.connectionTest(payload, createRequestId('mcpTest')))
  },
  plugin: {
    prepare: (payload: unknown) => call('pluginPrepare', window.enterpriseAgent.plugin.prepare(payload, createRequestId('pluginPrepare')))
  },
  publish: {
    uploadPackage: (payload: unknown) => call('uploadPackage', window.enterpriseAgent.publish.uploadPackage(payload, createRequestId('uploadPackage'))),
    createSubmission: (payload: unknown) => call('createSubmission', window.enterpriseAgent.publish.createSubmission(payload, createRequestId('createSubmission'))),
    listMine: () => call('listSubmissions', window.enterpriseAgent.publish.listMine(createRequestId('listSubmissions'))),
    withdraw: (submissionID: string) => call('withdrawSubmission', window.enterpriseAgent.publish.withdraw(submissionID, createRequestId('withdrawSubmission'))),
    resubmit: (submissionID: string, payload: unknown) => call('resubmitSubmission', window.enterpriseAgent.publish.resubmit(submissionID, payload, createRequestId('resubmitSubmission')))
  },
  notifications: {
    list: () => call('notifications', window.enterpriseAgent.notifications.list(createRequestId('notifications'))),
    markRead: (notificationID: string) => call('notificationRead', window.enterpriseAgent.notifications.markRead(notificationID, createRequestId('notificationRead')))
  },
  clientUpdate: {
    check: () => call('updateCheck', window.enterpriseAgent.clientUpdate.check(createRequestId('updateCheck'))),
    pending: () => call('updatePending', window.enterpriseAgent.clientUpdate.getPending(createRequestId('updatePending'))),
    download: () => call('updateDownload', window.enterpriseAgent.clientUpdate.confirmDownload(createRequestId('updateDownload'))),
    cancel: (reason?: string) => call('updateCancel', window.enterpriseAgent.clientUpdate.cancel(reason, createRequestId('updateCancel'))),
    install: () => call('updateInstall', window.enterpriseAgent.clientUpdate.confirmInstall(createRequestId('updateInstall')))
  },
  startup: {
    status: () => call('startupStatus', window.enterpriseAgent.startup.getStatus(createRequestId('startupStatus'))),
    clearSession: () => call('startupClearSession', window.enterpriseAgent.startup.clearSession(createRequestId('startupClearSession'))),
    rebuildLocalDatabase: () => call('startupRebuildLocalDatabase', window.enterpriseAgent.startup.rebuildLocalDatabase(createRequestId('startupRebuildLocalDatabase'))),
    retry: () => call('startupRetry', window.enterpriseAgent.startup.retry(createRequestId('startupRetry')))
  }
};

async function call<T>(_label: string, promise: Promise<import('../../shared/ipc').IpcResult<T>>): Promise<T> {
  return unwrapResult(await promise);
}
