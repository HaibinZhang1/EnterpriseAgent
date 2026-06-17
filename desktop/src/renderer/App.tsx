import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Shell } from './components/Shell';
import { AgentHomePage } from './pages/AgentHomePage';
import { CommunityHomePage } from './pages/CommunityHomePage';
import { SearchResultsPage } from './pages/SearchResultsPage';
import { LocalPage } from './pages/LocalPage';
import { LoginModal } from './features/auth/LoginModal';
import { ChangePasswordModal } from './features/auth/PasswordModals';
import { ExtensionActionModal, type ActionResultView } from './features/extension/ExtensionActionModal';
import { ExtensionDetailDrawer } from './features/extension/ExtensionDetailDrawer';
import { DangerConfirmModal } from './features/local/DangerConfirmModal';
import { NotificationsPanel } from './features/notifications/NotificationsPanel';
import { MySubmissionsDrawer } from './features/publish/MySubmissionsDrawer';
import { PublishWizard, submitValidationMessage, type PublishDraft } from './features/publish/PublishWizard';
import { SettingsModal } from './features/settings/SettingsModal';
import { UpdateModal } from './features/update/UpdateModal';
import { Button } from './components/Button';
import { ErrorState } from './components/ErrorState';
import { LoadingState } from './components/LoadingState';
import { Modal } from './components/Modal';
import { desktopApi } from './lib/api';
import { toUiError, UiApiError } from './lib/errors';
import { normalizeCatalogHome, normalizeExtension, normalizeLocalResourceSnapshot, normalizeNotifications, normalizePublishResult, normalizeSearchResults, normalizeSessionUser, normalizeUpdateState, normalizeVersions } from './lib/normalize';
import type { AppTab, CatalogHome, DetailState, DeviceSummary, ExtensionSummary, LoadState, LocalInventoryScanSummary, LocalLifecycleSnapshot, LocalResourceSnapshot, LocalTab, NotificationItem, OfflineState, PublishResult, RememberedLoginState, SessionUser, UiError, UpdateState, VersionSummary } from './types/desktop';

const emptyHome: CatalogHome = { skills: [], mcps: [], plugins: [], hot: [], stars: [], downloads: [] };
const emptyResources: LocalResourceSnapshot = {
  resources: [],
  bindings: [],
  files: [],
  events: [],
  findings: [],
  rows: [],
  summary: {
    resourceCount: 0,
    bindingCount: 0,
    fileCount: 0,
    eventCount: 0,
    pendingSyncEvents: 0,
    failureCount: 0,
    generatedAt: new Date(0).toISOString()
  }
};
const emptyLifecycle: LocalLifecycleSnapshot = { extensions: [], versions: [], targets: [], tools: [], projects: [], mcpInstallations: [], pluginInstallations: [], resources: emptyResources };
const localOnlyDetailStatuses = new Set([
  'scanned',
  'installed',
  'enabled',
  'connected',
  'failed',
  'partial_success',
  'scope_reduced',
  'security_blocked',
  'security_risk'
]);

type ModalName = 'none' | 'login' | 'settings' | 'notifications' | 'update' | 'publish' | 'submissions' | 'account' | 'password' | 'cleanup';

export interface EnterpriseAgentViewModel {
  bootState: LoadState;
  bootError?: UiError;
  activeTab: AppTab;
  localTab: LocalTab;
  showingSearch: boolean;
  searchQuery: string;
  searchState: LoadState;
  searchError?: UiError;
  searchItems: ExtensionSummary[];
  catalogState: LoadState;
  catalogError?: UiError;
  catalogHome: CatalogHome;
  rememberedLogin: RememberedLoginState;
  user?: SessionUser;
  device?: DeviceSummary;
  offline?: OfflineState;
  lifecycle: LocalLifecycleSnapshot;
  localScanState: LoadState;
  localScanSummary?: LocalInventoryScanSummary;
  localScanError?: UiError;
  detail?: DetailState;
  selectedAction?: ExtensionSummary;
  actionBusy: boolean;
  actionError?: UiError;
  actionResult?: ActionResultView;
  notifications: NotificationItem[];
  submissionsState: LoadState;
  submissions: Array<Record<string, unknown>>;
  submissionsError?: UiError;
  publishBusy: boolean;
  publishError?: UiError;
  publishResult?: PublishResult;
  settingsConfig: Record<string, unknown>;
  settingsBusy: boolean;
  settingsError?: UiError;
  passwordBusy: boolean;
  passwordError?: UiError;
  updateBusy: boolean;
  updateState?: UpdateState;
  startupRecoveryBusy?: string;
  startupRecoveryMessage?: string;
  cleanupBusy: boolean;
  cleanupError?: UiError;
  cleanupResult?: ActionResultView;
  modal: ModalName;
  cleanupTarget?: Record<string, unknown>;
}

export interface EnterpriseAgentActions {
  changeTab: (tab: AppTab) => void;
  changeLocalTab: (tab: LocalTab) => void;
  refreshLocal: () => void;
  backToCommunity: () => void;
  search: (query: string) => void;
  openDetail: (item: ExtensionSummary) => void;
  closeDetail: () => void;
  star: (item: ExtensionSummary) => void;
  openAction: (item: ExtensionSummary) => void;
  closeAction: () => void;
  runAction: (payload: { targetPath: string; variables: Record<string, string>; installMode?: string; adapterId?: string; operation?: string; dryRun: boolean }) => void;
  openModal: (modal: ModalName) => void;
  closeModal: () => void;
  login: (username: string, password: string, rememberPassword: boolean) => void;
  clearRememberedLogin: () => void;
  logout: () => void;
  saveSettings: (payload: Record<string, unknown>) => void;
  changePassword: (oldPassword: string, newPassword: string) => void;
  checkUpdate: () => void;
  downloadUpdate: () => void;
  cancelUpdate: () => void;
  installUpdate: () => void;
  clearStartupSession: () => void;
  rebuildStartupDatabase: () => void;
  retryStartup: () => void;
  submitPublish: (draft: PublishDraft) => void;
  resetPublishState: () => void;
  refreshSubmissions: () => void;
  withdrawSubmission: (submissionID: string) => void;
  markNotificationRead: (id: string) => void;
  requestCleanup: (row: Record<string, unknown>) => void;
  confirmCleanup: () => void;
}

type LocalLoadApi = Pick<typeof desktopApi.local, 'scanInventory' | 'resources'>;

interface LocalLoadOutcome {
  scanSummary?: LocalInventoryScanSummary;
  scanError?: UiError;
  resources?: unknown;
  resourceError?: UiError;
}

export async function readLocalData(localApi: LocalLoadApi = desktopApi.local): Promise<LocalLoadOutcome> {
  const outcome: LocalLoadOutcome = {};
  try {
    const scan = await localApi.scanInventory();
    outcome.scanSummary = isRecord(scan) ? scan as LocalInventoryScanSummary : undefined;
  } catch (error) {
    outcome.scanError = toUiError(error);
  }
  try {
    outcome.resources = await localApi.resources();
  } catch (error) {
    outcome.resourceError = toUiError(error);
  }
  return outcome;
}

export function applyLocalLoadOutcome(
  current: EnterpriseAgentViewModel,
  outcome: LocalLoadOutcome
): Pick<EnterpriseAgentViewModel, 'localScanState' | 'localScanSummary' | 'localScanError' | 'lifecycle'> {
  const visibleError = outcome.resourceError ?? outcome.scanError;
  return {
    localScanState: visibleError ? 'error' : 'ready',
    localScanSummary: outcome.scanSummary ?? current.localScanSummary,
    localScanError: visibleError,
    lifecycle: outcome.resourceError
      ? { ...current.lifecycle, resources: emptyResources }
      : outcome.resources !== undefined
        ? { ...current.lifecycle, resources: normalizeLocalResourceSnapshot(outcome.resources) }
        : current.lifecycle
  };
}

export function App() {
  const [view, setView] = useState<EnterpriseAgentViewModel>(() => initialView());

  useEffect(() => applyRendererTheme(view.settingsConfig), [view.settingsConfig]);

  const loadCommunity = useCallback(async () => {
    setView((current) => ({ ...current, catalogState: 'loading', catalogError: undefined }));
    try {
      const home = normalizeCatalogHome(await desktopApi.catalog.home());
      setView((current) => ({ ...current, catalogHome: home, catalogState: 'ready' }));
    } catch (error) {
      setView((current) => ({ ...current, catalogState: 'error', catalogError: toUiError(error) }));
    }
  }, []);

  const loadLocal = useCallback(async () => {
    setView((current) => ({ ...current, localScanState: 'loading', localScanError: undefined }));
    const outcome = await readLocalData();
    setView((current) => ({
      ...current,
      ...applyLocalLoadOutcome(current, outcome)
    }));
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const items = normalizeNotifications(await desktopApi.notifications.list());
      setView((current) => ({ ...current, notifications: items }));
    } catch {
      setView((current) => current);
    }
  }, []);

  const refreshSubmissions = useCallback(async () => {
    setView((current) => ({ ...current, submissionsState: 'loading', submissionsError: undefined }));
    try {
      const result = await desktopApi.publish.listMine();
      setView((current) => ({ ...current, submissionsState: 'ready', submissions: extractRecords(result) }));
    } catch (error) {
      setView((current) => ({ ...current, submissionsState: 'error', submissionsError: toUiError(error) }));
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function boot() {
      setView((current) => ({ ...current, bootState: 'loading' }));
      try {
        await waitForStartupReady();
        if (!active) return;
        const [session, remembered, device, offline, config, pendingUpdate] = await Promise.all([
          desktopApi.auth.getSession(),
          desktopApi.auth.getRememberedLogin().catch(() => ({ remembered: false, autoLogin: false })),
          desktopApi.device.info(),
          desktopApi.local.offline(),
          desktopApi.settings.get(),
          desktopApi.clientUpdate.pending().catch(() => undefined)
        ]);
        if (!active) return;
        let hasSession = Boolean((session as { hasSession?: boolean }).hasSession);
        const rememberedLogin = normalizeRememberedLogin(remembered);
        let user: SessionUser | undefined;
        let bootError: UiError | undefined;
        if (hasSession) {
          try {
            user = normalizeSessionUser(await desktopApi.auth.me());
          } catch (error) {
            const uiError = toUiError(error);
            if (!isRecoverableBootError(uiError)) throw error;
            bootError = uiError;
          }
        } else if (rememberedLogin.remembered && rememberedLogin.autoLogin) {
          try {
            const loginResult = await desktopApi.auth.autoLogin();
            user = normalizeSessionUser(loginResult) ?? normalizeSessionUser(await desktopApi.auth.me());
            hasSession = Boolean(user);
          } catch (error) {
            bootError = toUiError(error);
          }
        }
        setView((current) => ({
          ...current,
          bootState: 'ready',
          bootError,
          modal: hasSession ? current.modal : 'login',
          rememberedLogin,
          user,
          device: device as DeviceSummary,
          offline: offline as OfflineState,
          settingsConfig: isRecord(config) ? config : {},
          updateState: pendingUpdate ? normalizeUpdateState(pendingUpdate) : current.updateState
        }));
        if (hasSession && user) {
          await desktopApi.local.syncPending({ online: Boolean((offline as OfflineState).online), previousOnline: false, reason: 'startup' }).catch(() => undefined);
          await Promise.allSettled([loadCommunity(), loadLocal(), loadNotifications()]);
          if (user?.mustChangePassword) setView((current) => ({ ...current, modal: 'password' }));
        } else if (hasSession) {
          await loadLocal();
        }
      } catch (error) {
        setView((current) => ({ ...current, bootState: 'error', bootError: toUiError(error), modal: 'login' }));
      }
    }
    void boot();
    return () => { active = false; };
  }, [loadCommunity, loadLocal, loadNotifications]);

  const actions = useMemo<EnterpriseAgentActions>(() => createEnterpriseAgentActions({
    view,
    setView,
    loadCommunity,
    loadLocal,
    loadNotifications,
    refreshSubmissions
  }), [loadCommunity, loadLocal, loadNotifications, refreshSubmissions, view.cleanupTarget, view.selectedAction, view.user?.departmentId]);

  return <EnterpriseAgentAppView model={view} actions={actions} />;
}

type EnterpriseAgentViewSetter = Dispatch<SetStateAction<EnterpriseAgentViewModel>>;

interface EnterpriseAgentActionDependencies {
  view: Pick<EnterpriseAgentViewModel, 'selectedAction' | 'cleanupTarget' | 'user'>;
  setView: EnterpriseAgentViewSetter;
  loadCommunity: () => Promise<void>;
  loadLocal: () => Promise<void>;
  loadNotifications: () => Promise<void>;
  refreshSubmissions: () => Promise<void>;
}

export function createEnterpriseAgentActions({
  view,
  setView,
  loadCommunity,
  loadLocal,
  loadNotifications,
  refreshSubmissions
}: EnterpriseAgentActionDependencies): EnterpriseAgentActions {
  return {
    changeTab: (tab) => {
      setView((current) => ({ ...current, activeTab: tab, showingSearch: tab === 'community' ? current.showingSearch : false }));
      if (tab === 'community') void loadCommunity();
      if (tab === 'local') void loadLocal();
    },
    changeLocalTab: (tab) => setView((current) => ({ ...current, localTab: tab })),
    refreshLocal: () => { void loadLocal(); },
    backToCommunity: () => setView((current) => ({ ...current, showingSearch: false, searchQuery: '', searchItems: [], searchState: 'idle' })),
    search: async (query) => {
      setView((current) => ({ ...current, activeTab: 'community', showingSearch: true, searchQuery: query, searchState: 'loading', searchError: undefined }));
      try {
        const items = normalizeSearchResults(await desktopApi.catalog.search(query));
        setView((current) => ({ ...current, searchState: 'ready', searchItems: items }));
      } catch (error) {
        setView((current) => ({ ...current, searchState: 'error', searchError: toUiError(error) }));
      }
    },
    openDetail: async (item) => {
      setView((current) => ({ ...current, detail: { state: 'loading', item, versions: [] } }));
      try {
        const [detail, versions] = await Promise.all([desktopApi.extension.detail(item.id), desktopApi.extension.versions(item.id)]);
        setView((current) => ({ ...current, detail: { state: 'ready', item: normalizeExtension(detail, item.type), raw: detail, source: 'remote', versions: normalizeVersions(versions) } }));
      } catch (error) {
        const uiError = toUiError(error);
        if (shouldUseLocalDetailFallback(item, uiError)) {
          setView((current) => ({ ...current, detail: { state: 'ready', item, raw: { localOnly: true, error: uiError }, source: 'local-fallback', versions: localFallbackVersions(item) } }));
          return;
        }
        setView((current) => ({ ...current, detail: { state: 'error', item, versions: [], error: uiError } }));
      }
    },
    closeDetail: () => setView((current) => ({ ...current, detail: undefined })),
    star: async (item) => {
      const next = !item.starred;
      setView((current) => replaceExtension(current, item.id, { starred: next, starCount: Math.max(0, (item.starCount ?? 0) + (next ? 1 : -1)) }));
      try {
        await desktopApi.extension.setStar(item.id, next);
      } catch {
        setView((current) => replaceExtension(current, item.id, { starred: item.starred, starCount: item.starCount }));
      }
    },
    openAction: (item) => setView((current) => ({ ...current, selectedAction: item, actionError: undefined, actionResult: undefined })),
    closeAction: () => setView((current) => ({ ...current, selectedAction: undefined, actionError: undefined, actionResult: undefined })),
    runAction: async (payload) => {
      const item = view.selectedAction;
      if (!item) return;
      setView((current) => ({ ...current, actionBusy: true, actionError: undefined }));
      try {
        const result = item.type === 'skill'
          ? await desktopApi.extension.install({ extensionID: item.id, version: item.version, targetPath: payload.targetPath, adapterId: payload.adapterId, dryRun: payload.dryRun })
          : item.type === 'mcp'
            ? await desktopApi.mcp.configure({ extensionID: item.id, targetConfigPath: payload.targetPath, variables: payload.variables, adapterId: payload.adapterId, dryRun: payload.dryRun })
            : await desktopApi.plugin.prepare({ extensionID: item.id, targetPath: payload.targetPath, installMode: payload.installMode, adapterId: payload.adapterId, operation: payload.operation, dryRun: payload.dryRun });
        setView((current) => ({ ...current, actionBusy: false, actionResult: normalizeActionResult(result) }));
        if (!payload.dryRun) void loadLocal();
      } catch (error) {
        setView((current) => ({ ...current, actionBusy: false, actionError: toUiError(error) }));
      }
    },
    openModal: (modal) => {
      setView((current) => ({ ...current, modal }));
      if (modal === 'submissions') void refreshSubmissions();
      if (modal === 'notifications') void loadNotifications();
    },
    closeModal: () => setView((current) => ({ ...current, modal: 'none', cleanupTarget: undefined, cleanupError: undefined, cleanupResult: undefined })),
    login: async (username, password, rememberPassword) => {
      setView((current) => ({ ...current, bootState: 'loading', bootError: undefined }));
      try {
        const result = await desktopApi.auth.login(username, password, rememberPassword);
        const user = normalizeSessionUser(result) ?? normalizeSessionUser(await desktopApi.auth.me());
        setView((current) => ({
          ...current,
          user,
          rememberedLogin: rememberPassword
            ? { remembered: true, username, autoLogin: true }
            : { remembered: false, autoLogin: false },
          modal: user?.mustChangePassword ? 'password' : 'none',
          bootState: 'ready'
        }));
        await Promise.allSettled([loadCommunity(), loadLocal(), loadNotifications()]);
      } catch (error) {
        setView((current) => ({ ...current, bootState: 'ready', bootError: toUiError(error), modal: 'login' }));
      }
    },
    clearRememberedLogin: async () => {
      await desktopApi.auth.clearRememberedLogin();
      setView((current) => ({ ...current, rememberedLogin: { remembered: false, autoLogin: false } }));
    },
    logout: async () => {
      await desktopApi.auth.logout().catch(() => undefined);
      setView((current) => ({ ...current, user: undefined, modal: 'login', notifications: [], submissions: [] }));
    },
    saveSettings: async (payload) => {
      setView((current) => ({ ...current, settingsBusy: true, settingsError: undefined }));
      try {
        const saved = await desktopApi.settings.save(payload);
        setView((current) => ({ ...current, settingsBusy: false, settingsConfig: isRecord(saved) ? saved : current.settingsConfig }));
      } catch (error) {
        setView((current) => ({ ...current, settingsBusy: false, settingsError: toUiError(error) }));
      }
    },
    changePassword: async (oldPassword, newPassword) => {
      setView((current) => ({ ...current, passwordBusy: true, passwordError: undefined }));
      try {
        await desktopApi.auth.changePassword({ oldPassword, newPassword });
        setView((current) => ({ ...current, user: undefined, rememberedLogin: { remembered: false, autoLogin: false }, passwordBusy: false, modal: 'login', notifications: [], submissions: [] }));
      } catch (error) {
        setView((current) => ({ ...current, passwordBusy: false, passwordError: toUiError(error) }));
      }
    },
    checkUpdate: async () => {
      setView((current) => ({ ...current, updateBusy: true }));
      try {
        const result = normalizeUpdateState(await desktopApi.clientUpdate.check());
        setView((current) => ({ ...current, updateBusy: false, updateState: result }));
      } catch (error) {
        setView((current) => ({ ...current, updateBusy: false, updateState: { ...current.updateState, error: toUiError(error) } }));
      }
    },
    downloadUpdate: async () => {
      setView((current) => ({ ...current, updateBusy: true }));
      try {
        const nextUpdate = normalizeUpdateState(await desktopApi.clientUpdate.download());
        setView((current) => ({ ...current, updateBusy: false, updateState: nextUpdate }));
      } catch (error) {
        setView((current) => ({ ...current, updateBusy: false, updateState: { ...current.updateState, error: toUiError(error) } }));
      }
    },
    cancelUpdate: async () => {
      setView((current) => ({ ...current, updateBusy: true }));
      try {
        await desktopApi.clientUpdate.cancel('USER_CANCELLED');
        setView((current) => ({ ...current, updateBusy: false, updateState: { state: 'cancelled' } }));
      } catch (error) {
        setView((current) => ({ ...current, updateBusy: false, updateState: { ...current.updateState, error: toUiError(error) } }));
      }
    },
    installUpdate: async () => {
      setView((current) => ({ ...current, updateBusy: true }));
      try {
        await desktopApi.clientUpdate.install();
        setView((current) => ({ ...current, updateBusy: false, updateState: { state: 'launched' } }));
      } catch (error) {
        setView((current) => ({ ...current, updateBusy: false, updateState: { ...current.updateState, error: toUiError(error) } }));
      }
    },
    clearStartupSession: async () => {
      setView((current) => ({ ...current, startupRecoveryBusy: 'clear-session', startupRecoveryMessage: undefined }));
      try {
        const result = await desktopApi.startup.clearSession();
        const message = isRecord(result) && typeof result.message === 'string'
          ? result.message
          : '已清除本地会话，请重新登录。';
        setView((current) => ({
          ...current,
          startupRecoveryBusy: undefined,
          startupRecoveryMessage: message,
          bootState: 'ready',
          bootError: undefined,
          user: undefined,
          modal: 'login'
        }));
      } catch (error) {
        setView((current) => ({ ...current, startupRecoveryBusy: undefined, bootError: toUiError(error), modal: 'login' }));
      }
    },
    rebuildStartupDatabase: async () => {
      setView((current) => ({ ...current, startupRecoveryBusy: 'rebuild-db', startupRecoveryMessage: undefined }));
      try {
        await desktopApi.startup.rebuildLocalDatabase();
        await desktopApi.startup.retry();
        setView((current) => ({ ...current, startupRecoveryBusy: undefined, startupRecoveryMessage: '已重建本地库，正在重新初始化客户端。', bootState: 'loading' }));
        reloadRendererSoon();
      } catch (error) {
        setView((current) => ({ ...current, startupRecoveryBusy: undefined, bootError: toUiError(error) }));
      }
    },
    retryStartup: async () => {
      setView((current) => ({ ...current, startupRecoveryBusy: 'retry', startupRecoveryMessage: undefined, bootState: 'loading' }));
      try {
        await desktopApi.startup.retry();
        reloadRendererSoon();
      } catch (error) {
        setView((current) => ({ ...current, startupRecoveryBusy: undefined, bootError: toUiError(error) }));
      }
    },
    submitPublish: async (draft) => {
      setView((current) => ({ ...current, publishBusy: true, publishError: undefined, publishResult: undefined }));
      try {
        const validation = submitValidationMessage(draft);
        if (validation) {
          setView((current) => ({
            ...current,
            publishBusy: false,
            publishError: { code: 'validation_failed', message: validation }
          }));
          return;
        }
        const authorizationScope = buildAuthorizationScope(draft, view.user?.departmentId);
        if (!authorizationScope) {
          setView((current) => ({
            ...current,
            publishBusy: false,
            publishError: { code: 'validation_failed', message: '当前账号缺少部门信息，无法提交部门授权范围。' }
          }));
          return;
        }
        const uploadRefs = [await uploadDraftFile(draft)];
        const result = normalizePublishResult(await desktopApi.publish.createSubmission({
          idempotencyKey: `renderer:${draft.extensionId}:${draft.version}:${globalThis.crypto.randomUUID()}`,
          request: {
            type: 'FIRST_PUBLISH',
            extensionType: draft.extensionType.toUpperCase(),
            extensionId: draft.extensionId,
            version: draft.version,
            metadata: { name: draft.name, summary: draft.summary },
            authorizationScope,
            visibilityMode: draft.visibilityMode,
            riskStatement: { summary: draft.riskStatement },
            typePayload: {},
            uploadRefs
          }
        }));
        setView((current) => ({ ...current, publishBusy: false, publishResult: result }));
        void refreshSubmissions();
      } catch (error) {
        setView((current) => ({ ...current, publishBusy: false, publishError: toUiError(error) }));
      }
    },
    resetPublishState: () => setView((current) => ({ ...current, publishError: undefined, publishResult: undefined })),
    refreshSubmissions,
    withdrawSubmission: async (submissionID) => {
      try {
        await desktopApi.publish.withdraw(submissionID);
        void refreshSubmissions();
      } catch (error) {
        setView((current) => ({ ...current, submissionsError: toUiError(error), submissionsState: 'error' }));
      }
    },
    markNotificationRead: async (id) => {
      setView((current) => ({ ...current, notifications: current.notifications.map((item) => item.id === id ? { ...item, read: true } : item) }));
      await desktopApi.notifications.markRead(id).catch(() => undefined);
    },
    requestCleanup: (row) => setView((current) => ({ ...current, modal: 'cleanup', cleanupTarget: row, cleanupError: undefined, cleanupResult: undefined })),
    confirmCleanup: async () => {
      const target = view.cleanupTarget;
      if (!target) return;
      setView((current) => ({ ...current, cleanupBusy: true, cleanupError: undefined }));
      try {
        const result = await desktopApi.local.cleanup(target);
        setView((current) => ({ ...current, cleanupBusy: false, cleanupResult: normalizeActionResult(result) }));
        void loadLocal();
      } catch (error) {
        setView((current) => ({ ...current, cleanupBusy: false, cleanupError: toUiError(error) }));
      }
    }
  };
}

export function EnterpriseAgentAppView({ model, actions }: { model: EnterpriseAgentViewModel; actions: EnterpriseAgentActions }) {
  const unreadCount = model.notifications.filter((item) => !item.read).length;
  const showLogin = model.modal === 'login';
  const showFatalBootError = model.bootState === 'error' && !model.user && !isRecoverableBootError(model.bootError);

  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : undefined;
  const isLight = model.settingsConfig.theme === 'glass-light' || (model.settingsConfig.theme !== 'glass-dark' && media?.matches);
  const currentTheme = isLight ? 'light' : 'dark';

  const handleToggleTheme = () => {
    const nextTheme = currentTheme === 'light' ? 'glass-dark' : 'glass-light';
    actions.saveSettings({ ...model.settingsConfig, theme: nextTheme });
  };

  return (
    <Shell
      active={model.activeTab}
      onChangeTab={actions.changeTab}
      user={model.user}
      offline={model.offline}
      unreadCount={unreadCount}
      onNotifications={() => actions.openModal('notifications')}
      onAccount={() => actions.openModal(model.user ? 'account' : 'login')}
      onSettings={() => actions.openModal('settings')}
      theme={currentTheme}
      onToggleTheme={handleToggleTheme}
    >
      {model.bootState === 'loading' && !model.user ? <main className="page"><LoadingState label="正在初始化客户端" /></main> : null}
      {showFatalBootError ? (
        <main className="page">
          <ErrorState error={model.bootError} title="客户端初始化失败" />
          <StartupRecoveryPanel
            busy={model.startupRecoveryBusy}
            message={model.startupRecoveryMessage}
            onClearSession={actions.clearStartupSession}
            onRebuildDatabase={actions.rebuildStartupDatabase}
            onRetry={actions.retryStartup}
          />
        </main>
      ) : null}
      {model.activeTab === 'agent' ? (
        <AgentHomePage
          user={model.user}
          device={model.device}
          offline={model.offline}
          updateState={model.updateState}
          onGo={actions.changeTab}
          onOpenSettings={() => actions.openModal('settings')}
          onOpenUpdate={() => actions.openModal('update')}
        />
      ) : null}
      {model.activeTab === 'community' && !model.showingSearch ? (
        <CommunityHomePage
          state={model.catalogState}
          home={model.catalogHome}
          error={model.catalogError}
          offline={model.offline?.online === false}
          onSearch={actions.search}
          onOpen={actions.openDetail}
          onStar={actions.star}
          onOpenPublish={() => actions.openModal('publish')}
          onOpenSubmissions={() => actions.openModal('submissions')}
        />
      ) : null}
      {model.activeTab === 'community' && model.showingSearch ? (
        <main className="page" aria-label="搜索结果" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <SearchResultsPage
            query={model.searchQuery}
            state={model.searchState}
            items={model.searchItems}
            error={model.searchError}
            onBack={actions.backToCommunity}
            onOpen={actions.openDetail}
            onPrimaryAction={actions.openAction}
            onStar={actions.star}
          />
        </main>
      ) : null}
      {model.activeTab === 'local' ? (
        <main className="page" aria-label="本地" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <LocalPage
            snapshot={model.lifecycle.resources ?? emptyResources}
            activeTab={model.localTab}
            offline={model.offline?.online === false}
            localScanState={model.localScanState}
            localScanSummary={model.localScanSummary}
            localScanError={model.localScanError}
            onChangeTab={actions.changeLocalTab}
            onRefreshLocal={actions.refreshLocal}
            settingsConfig={model.settingsConfig}
          />
        </main>
      ) : null}

      {model.detail ? <ExtensionDetailDrawer detail={model.detail} onClose={actions.closeDetail} onPrimaryAction={actions.openAction} onStar={actions.star} /> : null}
      {model.selectedAction ? (
        <ExtensionActionModal
          item={model.selectedAction}
          busy={model.actionBusy}
          error={model.actionError}
          result={model.actionResult}
          onClose={actions.closeAction}
          onOpenLocal={() => {
            actions.closeAction();
            actions.changeTab('local');
          }}
          onRun={actions.runAction}
        />
      ) : null}
      {showLogin ? (
        <LoginModal
          busy={model.bootState === 'loading'}
          error={model.bootError}
          rememberedLogin={model.rememberedLogin}
          onClearRememberedLogin={actions.clearRememberedLogin}
          onClose={actions.closeModal}
          onLogin={actions.login}
        />
      ) : null}
      {model.modal === 'settings' ? <SettingsModal config={model.settingsConfig} busy={model.settingsBusy} error={model.settingsError} canChangePassword={Boolean(model.user)} onClose={actions.closeModal} onSave={actions.saveSettings} onChangePassword={() => actions.openModal('password')} onOpenUpdate={() => actions.openModal('update')} /> : null}
      {model.modal === 'password' ? <ChangePasswordModal force={model.user?.mustChangePassword} busy={model.passwordBusy} error={model.passwordError} onClose={actions.closeModal} onSubmit={actions.changePassword} /> : null}
      {model.modal === 'notifications' ? <NotificationsPanel items={model.notifications} onClose={actions.closeModal} onRead={actions.markNotificationRead} /> : null}
      {model.modal === 'update' ? <UpdateModal update={model.updateState} busy={model.updateBusy} onClose={actions.closeModal} onCheck={actions.checkUpdate} onDownload={actions.downloadUpdate} onCancel={actions.cancelUpdate} onInstall={actions.installUpdate} /> : null}
      {model.modal === 'publish' ? (
        <PublishWizard
          busy={model.publishBusy}
          error={model.publishError}
          result={model.publishResult}
          onClose={actions.closeModal}
          onSubmit={actions.submitPublish}
          onResetError={actions.resetPublishState}
        />
      ) : null}
      {model.modal === 'submissions' ? <MySubmissionsDrawer state={model.submissionsState} items={model.submissions} error={model.submissionsError} onClose={actions.closeModal} onRefresh={actions.refreshSubmissions} onWithdraw={actions.withdrawSubmission} /> : null}
      {model.modal === 'account' ? (
        <AccountMenu
          user={model.user}
          onClose={actions.closeModal}
          onChangePassword={() => actions.openModal('password')}
          onLogin={() => actions.openModal('login')}
          onSettings={() => actions.openModal('settings')}
          onLogout={actions.logout}
          theme={currentTheme}
          onToggleTheme={handleToggleTheme}
        />
      ) : null}
      {model.modal === 'cleanup' ? <DangerConfirmModal title="本地清理确认" message="该操作只处理本地记录或托管目标，不需要服务端授权状态为可用。" busy={model.cleanupBusy} error={model.cleanupError} result={model.cleanupResult} onClose={actions.closeModal} onConfirm={actions.confirmCleanup} /> : null}
    </Shell>
  );
}

function AccountMenu({
  user,
  onClose,
  onChangePassword,
  onLogin,
  onSettings,
  onLogout,
  theme,
  onToggleTheme
}: {
  user?: SessionUser;
  onClose: () => void;
  onChangePassword: () => void;
  onLogin: () => void;
  onSettings: () => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  return (
    <Modal title="账号与设置" onClose={onClose} size="small">
      <p style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-primary)' }}>
        当前账号：<strong>{user?.displayName ?? user?.username ?? '未登录'}</strong>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Button onClick={onSettings} style={{ width: '100%', justifyContent: 'center' }}>
          ⚙️ 客户端设置
        </Button>
        <Button onClick={onToggleTheme} style={{ width: '100%', justifyContent: 'center' }}>
          {theme === 'dark' ? '☀️ 切换至浅色模式' : '🌙 切换至深色模式'}
        </Button>
        {user ? (
          <>
            <Button onClick={onChangePassword} style={{ width: '100%', justifyContent: 'center' }}>
              🔑 修改密码
            </Button>
            <Button tone="danger" onClick={onLogout} style={{ width: '100%', justifyContent: 'center' }}>
              🚪 退出登录
            </Button>
          </>
        ) : (
          <Button tone="primary" onClick={onLogin} style={{ width: '100%', justifyContent: 'center' }}>
            登录
          </Button>
        )}
      </div>
    </Modal>
  );
}

function StartupRecoveryPanel({
  busy,
  message,
  onClearSession,
  onRebuildDatabase,
  onRetry
}: {
  busy?: string;
  message?: string;
  onClearSession: () => void;
  onRebuildDatabase: () => void;
  onRetry: () => void;
}) {
  return (
    <section className="panel" aria-label="客户端恢复">
      <header className="section-header">
        <h2>客户端恢复</h2>
        <span className="meta">本地服务未就绪</span>
      </header>
      <p className="muted">可先清除旧会话后重新登录；若本地库异常，可重建本地库并重新初始化。</p>
      {message ? <p className="success-text">{message}</p> : null}
      <div className="card-action-row">
        <Button onClick={onClearSession} disabled={!!busy}>
          {busy === 'clear-session' ? '处理中' : '清除会话'}
        </Button>
        <Button onClick={onRebuildDatabase} disabled={!!busy}>
          {busy === 'rebuild-db' ? '处理中' : '重建本地库'}
        </Button>
        <Button tone="primary" onClick={onRetry} disabled={!!busy}>
          {busy === 'retry' ? '处理中' : '重新初始化'}
        </Button>
      </div>
    </section>
  );
}

export function initialView(): EnterpriseAgentViewModel {
  return {
    bootState: 'idle',
    activeTab: 'agent',
    localTab: 'overview',
    showingSearch: false,
    searchQuery: '',
    searchState: 'idle',
    searchItems: [],
    catalogState: 'idle',
    catalogHome: emptyHome,
    rememberedLogin: { remembered: false, autoLogin: false },
    lifecycle: emptyLifecycle,
    localScanState: 'idle',
    actionBusy: false,
    notifications: [],
    submissionsState: 'idle',
    submissions: [],
    publishBusy: false,
    settingsConfig: {},
    settingsBusy: false,
    passwordBusy: false,
    updateBusy: false,
    cleanupBusy: false,
    modal: 'none'
  };
}

export function applyRendererTheme(config: Record<string, unknown>): (() => void) | undefined {
  if (typeof document === 'undefined') return undefined;
  const preference = normalizeTheme(config.theme);
  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : undefined;
  const update = () => {
    const resolved = resolveTheme(preference, Boolean(media?.matches));
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved === 'glass-light' ? 'light' : 'dark';
  };
  update();
  if (preference !== 'system' || !media) return undefined;
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

export function resolveTheme(preference: unknown, systemPrefersLight: boolean): 'glass-dark' | 'glass-light' {
  const normalized = normalizeTheme(preference);
  if (normalized === 'glass-light') return 'glass-light';
  if (normalized === 'system' && systemPrefersLight) return 'glass-light';
  return 'glass-dark';
}

export async function waitForStartupReady(
  statusLoader: () => Promise<unknown> = desktopApi.startup.status,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? 9000;
  const intervalMs = options.intervalMs ?? 150;
  const startedAt = Date.now();
  let lastStatus: Record<string, unknown> | undefined;
  while (Date.now() - startedAt <= timeoutMs) {
    const status = await statusLoader();
    const record = isRecord(status) ? status : {};
    lastStatus = record;
    const state = str(record.status);
    if (state === 'ready') return record;
    if (state === 'failed') throw startupStatusError(record);
    await delay(intervalMs);
  }
  throw new UiApiError({
    code: 'startup_failed',
    message: '客户端本地服务初始化超时，请稍后重试。',
    details: lastStatus
  });
}

function startupStatusError(record: Record<string, unknown>): UiApiError {
  const error = isRecord(record.error) ? record.error : {};
  return new UiApiError({
    code: str(error.code) ?? 'startup_failed',
    message: str(error.message) ?? '客户端本地服务初始化失败。',
    requestID: str(error.requestID),
    details: error.details ?? record
  });
}

function normalizeTheme(value: unknown): 'glass-dark' | 'glass-light' | 'system' {
  return value === 'glass-dark' || value === 'glass-light' || value === 'system' ? value : 'system';
}

function normalizeRememberedLogin(value: unknown): RememberedLoginState {
  const record = isRecord(value) ? value : {};
  const remembered = record.remembered === true;
  return {
    remembered,
    username: remembered ? str(record.username) : undefined,
    autoLogin: record.autoLogin === true,
    updatedAt: remembered ? str(record.updatedAt) : undefined
  };
}

function replaceExtension(model: EnterpriseAgentViewModel, id: string, patch: Partial<ExtensionSummary>): EnterpriseAgentViewModel {
  const replace = (items: ExtensionSummary[]) => items.map((item) => item.id === id ? { ...item, ...patch } : item);
  return {
    ...model,
    catalogHome: {
      skills: replace(model.catalogHome.skills),
      mcps: replace(model.catalogHome.mcps),
      plugins: replace(model.catalogHome.plugins),
      hot: replace(model.catalogHome.hot),
      stars: replace(model.catalogHome.stars),
      downloads: replace(model.catalogHome.downloads)
    },
    searchItems: replace(model.searchItems),
    detail: model.detail?.item?.id === id ? { ...model.detail, item: { ...model.detail.item, ...patch } } : model.detail
  };
}

export function normalizeActionResult(value: unknown): ActionResultView {
  const record = isRecord(value) ? value : {};
  const plan = isRecord(record.plan) ? record.plan : isRecord(value) && 'operation' in value ? value : {};
  const result = isRecord(record.result) ? record.result : {};
  const summary = isRecord(plan.summary) ? plan.summary : {};
  const manual = extractManualInstructions(record, plan);
  const connectionTest = isRecord(record.connectionTest) ? record.connectionTest : undefined;
  const rollbackResult = isRecord(record.rollbackResult) ? record.rollbackResult : undefined;
  const connectionStatus = str(connectionTest?.status);
  const connectionFailed = Boolean(connectionStatus && connectionStatus !== 'reachable');
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.filter((item): item is string => typeof item === 'string') : [];
  if (connectionFailed) {
    warnings.push(`MCP connection test failed: ${str(connectionTest?.message ?? connectionTest?.errorCode ?? connectionTest?.statusCode ?? connectionStatus) ?? connectionStatus}`);
  }
  const steps: ActionResultView['steps'] = Array.isArray(result.steps)
    ? result.steps.filter(isRecord).map((step) => ({ stepId: str(step.stepId), action: str(step.action), status: str(step.status), message: str(step.message) }))
    : Array.isArray(plan.steps)
      ? plan.steps.filter(isRecord).map((step) => ({ stepId: str(step.stepId), action: str(step.action), status: 'planned' }))
      : [];
  if (connectionTest) {
    steps.push({ stepId: 'mcp-connection-test', action: 'connection-test', status: connectionStatus ?? 'unknown', message: str(connectionTest.message ?? connectionTest.errorCode ?? connectionTest.statusCode) });
  }
  if (rollbackResult) {
    const rollbackSteps: ActionResultView['steps'] = Array.isArray(rollbackResult.steps)
      ? rollbackResult.steps.filter(isRecord).map((step) => ({ stepId: str(step.stepId), action: str(step.action) ?? 'rollback', status: str(step.status), message: str(step.message) }))
      : [{ stepId: 'mcp-config-rollback', action: 'rollback', status: str(rollbackResult.status), message: str(rollbackResult.message) }];
    steps.push(...rollbackSteps);
  }
  const planSteps = Array.isArray(plan.steps) ? plan.steps.filter(isRecord) : [];
  const linkStep = planSteps.find((step) => step.stepId === 'link-skill') ?? planSteps.find((step) => typeof step.targetPath === 'string');
  const copyStep = planSteps.find((step) => step.stepId === 'copy-package');
  const packageInfo = isRecord(record.packageInfo) ? record.packageInfo : {};
  return {
    status: connectionFailed ? 'connection_test_failed' : typeof result.status === 'string' ? result.status : typeof plan.dryRun === 'boolean' && plan.dryRun ? 'dry_run' : undefined,
    planTitle: typeof summary.title === 'string' ? summary.title : typeof plan.operation === 'string' ? plan.operation : undefined,
    artifactPath: str(packageInfo.packagePath ?? copyStep?.targetPath ?? linkStep?.sourcePath),
    targetPath: str(linkStep?.targetPath),
    warnings,
    manualInstructions: manual.instructions,
    manualInstructionsUrl: manual.instructionsUrl,
    steps
  };
}

function extractManualInstructions(record: Record<string, unknown>, plan: Record<string, unknown>): { instructions?: string; instructionsUrl?: string } {
  const definition = isRecord(record.definition) ? record.definition : {};
  const direct = {
    instructions: str(definition.manualInstructions ?? definition.manualInstallDoc),
    instructionsUrl: str(definition.manualInstructionsUrl ?? definition.manualInstallDocUrl ?? definition.externalDownload)
  };
  if (direct.instructions || direct.instructionsUrl) return direct;

  const steps = Array.isArray(plan.steps) ? plan.steps.filter(isRecord) : [];
  const manualStep = steps.find((step) => step.stepId === 'open-manual-instructions' && typeof step.content === 'string');
  if (!manualStep || typeof manualStep.content !== 'string') return {};
  try {
    const content = JSON.parse(manualStep.content) as Record<string, unknown>;
    return { instructions: str(content.instructions), instructionsUrl: str(content.instructionsUrl) };
  } catch {
    return {};
  }
}

async function uploadDraftFile(draft: PublishDraft): Promise<Record<string, unknown>> {
  if (!draft.file) return {};
  const contentBase64 = await readFileBase64(draft.file);
  const response = await desktopApi.publish.uploadPackage({
    uploadType: draft.extensionType === 'skill' ? 'SKILL_PACKAGE' : draft.extensionType === 'mcp' ? 'MCP_MANIFEST' : 'PLUGIN_PACKAGE',
    fileName: draft.file.name,
    mimeType: draft.file.type || 'application/octet-stream',
    contentBase64
  });
  return isRecord(response) ? {
    tempUploadId: response.tempUploadId ?? response.uploadId ?? response.id,
    sha256: response.sha256 ?? response.packageSha256,
    uploadType: response.uploadType,
    fileName: draft.file.name,
    precheck: response.precheck
  } : {};
}

function buildAuthorizationScope(draft: PublishDraft, departmentId?: string): Record<string, unknown> | undefined {
  if (draft.authorizationScope === 'ALL_EMPLOYEES') {
    return { scopeType: 'ALL_EMPLOYEES', departments: [] };
  }
  if (draft.authorizationScope === 'SELECTED_DEPARTMENTS') {
    return undefined;
  }
  if (!departmentId) {
    return undefined;
  }
  return {
    scopeType: draft.authorizationScope,
    departments: [{
      departmentId,
      includeChildren: draft.authorizationScope === 'DEPARTMENT_TREE'
    }]
  };
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function extractRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['items', 'content', 'submissions']) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isRecoverableBootError(error?: UiError): boolean {
  return error?.code === 'server_unavailable' || error?.code === 'unauthenticated';
}

export function shouldUseLocalDetailFallback(item: ExtensionSummary, error?: UiError): boolean {
  if (error?.code !== 'unauthenticated' && error?.code !== 'resource_not_found') return false;
  return isLocalOnlyStatus(item.status);
}

function reloadRendererSoon(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => window.location.reload(), 150);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function localFallbackVersions(item: ExtensionSummary): VersionSummary[] {
  if (!item.version || item.version === '-') return [];
  return [{ version: item.version, status: item.status }];
}

function isLocalOnlyStatus(status?: string): boolean {
  if (!status) return false;
  return localOnlyDetailStatuses.has(status.toLowerCase());
}
