import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnterpriseAgentAppView, applyLocalLoadOutcome, createEnterpriseAgentActions, initialView, normalizeActionResult, readLocalData, resolveTheme, shouldUseLocalDetailFallback, waitForStartupReady, type EnterpriseAgentActions, type EnterpriseAgentViewModel } from '../src/renderer/App';
import { ExtensionActionModal } from '../src/renderer/features/extension/ExtensionActionModal';
import { ExtensionDetailDrawer } from '../src/renderer/features/extension/ExtensionDetailDrawer';
import { MySubmissionsDrawer } from '../src/renderer/features/publish/MySubmissionsDrawer';
import { PublishWizard, type PublishDraft } from '../src/renderer/features/publish/PublishWizard';
import { SettingsModal } from '../src/renderer/features/settings/SettingsModal';
import { UpdateModal } from '../src/renderer/features/update/UpdateModal';
import { readableErrorMessage, UiApiError } from '../src/renderer/lib/errors';
import type { ExtensionKind, ExtensionSummary, LocalResourceSnapshot } from '../src/renderer/types/desktop';
import {
  aggregateResourceStatus,
  AuthStatuses,
  AuditStatuses,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  DetectionStatuses,
  DriftStatuses,
  LifecycleStatuses,
  LocalResourceSourceTypes,
  LocalResourceTypes,
  OperationStatuses,
  PathStatuses,
  ResourceScopeTypes,
  SyncStatuses
} from '../src/shared/local-resources';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderer app view', () => {
  it('shows login entry before auth and Agent home after auth with fixed desktop tabs', () => {
    const unauthenticated = renderView({ modal: 'login' });
    expect(unauthenticated).toContain('登录 Enterprise Agent Hub');
    expect(unauthenticated).toContain('记住密码并自动登录');
    expect(unauthenticated).toContain('Agent');
    expect(unauthenticated).toContain('社区');
    expect(unauthenticated).toContain('本地');

    const authenticated = renderView({ user: { username: 'alice', displayName: 'Alice' }, modal: 'none', bootState: 'ready' });
    expect(authenticated).toContain('Agent 工作台');
    expect(authenticated).toContain('当前账号：Alice');
  });

  it('renders remembered login state and auto-login failure in the login modal', () => {
    const html = renderView({
      user: undefined,
      modal: 'login',
      bootError: { code: 'unauthenticated', message: '自动登录失败，请重新输入密码。' },
      rememberedLogin: { remembered: true, username: 'alice', autoLogin: true }
    });
    expect(html).toContain('已保存账号：alice');
    expect(html).toContain('清除');
    expect(html).toContain('checked=""');
    expect(html).toContain('自动登录失败，请重新输入密码。');
  });

  it('allows unauthenticated users to dismiss the login modal and keep the shell visible', () => {
    const dismissed = renderView({ user: undefined, modal: 'none', bootState: 'ready' });
    expect(dismissed).not.toContain('<h2>登录 Enterprise Agent Hub</h2>');
    expect(dismissed).toContain('Agent 工作台');
    expect(dismissed).toContain('请登录后使用企业扩展能力');
  });

  it('keeps unauthenticated account and settings actions out of logged-in flows', () => {
    const account = renderView({ user: undefined, modal: 'account', bootState: 'ready' });
    expect(account).toContain('当前账号：<strong>未登录</strong>');
    expect(account).toContain('登录</button>');
    expect(account).not.toContain('修改密码');
    expect(account).not.toContain('退出登录');

    const settings = renderView({ user: undefined, modal: 'settings', bootState: 'ready' });
    expect(settings).toContain('客户端更新');
    expect(settings).not.toContain('修改密码');
  });

  it('keeps offline startup server failures out of the top-level initialization error', () => {
    const offline = renderView({
      user: undefined,
      modal: 'none',
      bootState: 'error',
      bootError: { code: 'server_unavailable', message: '无法连接服务端，请检查网络或服务状态。', requestID: 'req-offline-boot' },
      offline: { online: false }
    });
    expect(offline).toContain('当前离线：新增服务端动作已暂停');
    expect(offline).toContain('Agent 工作台');
    expect(offline).not.toContain('客户端初始化失败');
    expect(offline).not.toContain('req-offline-boot');
  });

  it('treats expired sessions as recoverable startup state on the local page', () => {
    const html = renderView({
      activeTab: 'local',
      user: undefined,
      modal: 'none',
      bootState: 'error',
      bootError: { code: 'unauthenticated', message: '登录已失效，请重新登录。', requestID: 'req-auth-boot' },
      lifecycle: { extensions: [], versions: [], targets: [], tools: [], projects: [], mcpInstallations: [], pluginInstallations: [] }
    });
    expect(html).toContain('本地资源管理');
    expect(html).toContain('打开本地页面：概览');
    expect(html).not.toContain('客户端初始化失败');
    expect(html).not.toContain('req-auth-boot');
  });

  it('shows startup recovery actions for unrecoverable local service boot failures', () => {
    const html = renderView({
      user: undefined,
      bootState: 'error',
      modal: 'login',
      bootError: { code: 'startup_failed', message: '客户端本地服务初始化超时，卡在 local-database-initialize。', requestID: 'req-startup' }
    });
    expect(html).toContain('客户端初始化失败');
    expect(html).toContain('客户端恢复');
    expect(html).toContain('清除会话');
    expect(html).toContain('重建本地库');
    expect(html).toContain('重新初始化');
    expect(html).toContain('登录 Enterprise Agent Hub');
  });

  it('waits for desktop startup readiness before normal boot IPC', async () => {
    const states = [{ status: 'starting' }, { status: 'ready', root: '/tmp/app' }];
    const calls: unknown[] = [];
    const ready = await waitForStartupReady(async () => {
      const value = states.shift() ?? { status: 'ready' };
      calls.push(value);
      return value;
    }, { timeoutMs: 100, intervalMs: 0 });
    expect(calls).toHaveLength(2);
    expect(ready).toMatchObject({ status: 'ready', root: '/tmp/app' });
  });

  it('surfaces failed desktop startup status as a recovery error', async () => {
    await expect(waitForStartupReady(async () => ({
      status: 'failed',
      error: { code: 'startup_failed', message: 'local db failed', requestID: 'req-startup' }
    }), { timeoutMs: 100, intervalMs: 0 })).rejects.toMatchObject({
      uiError: { code: 'startup_failed', message: 'local db failed', requestID: 'req-startup' }
    });
  });

  it('normalizes unauthenticated raw messages', () => {
    expect(readableErrorMessage('?????????', 'unauthenticated')).toBe('登录已失效，请重新登录。');
    expect(readableErrorMessage('raw unauthenticated backend error', 'unauthenticated')).toBe('登录已失效，请重新登录。');
  });

  it('renders community areas, empty rankings, search cards, and search requestId errors', () => {
    const item = extension('skill-one', 'skill');
    const home = renderView({
      activeTab: 'community',
      catalogState: 'ready',
      catalogHome: { skills: [item], mcps: [], plugins: [], hot: [], stars: [], downloads: [] }
    });
    expect(home).toContain('Skill 精选热榜');
    expect(home).toContain('MCP Server 热榜');
    expect(home).toContain('Plugin 工具热榜');
    expect(home).toContain('skill-one');

    const searchMcp = renderView({ activeTab: 'community', showingSearch: true, searchQuery: 'mcp', searchState: 'ready', searchItems: [extension('mcp-one', 'mcp'), extension('plugin-one', 'plugin')] });
    expect(searchMcp).toContain('搜索结果');
    expect(searchMcp).toContain('mcp-one');

    const searchPlugin = renderView({ activeTab: 'community', showingSearch: true, searchQuery: 'plugin', searchState: 'ready', searchItems: [extension('mcp-one', 'mcp'), extension('plugin-one', 'plugin')] });
    expect(searchPlugin).toContain('搜索结果');
    expect(searchPlugin).toContain('plugin-one');

    const failed = renderView({ activeTab: 'community', showingSearch: true, searchState: 'error', searchError: { message: '服务异常', requestID: 'req-search-1' } });
    expect(failed).toContain('搜索失败');
    expect(failed).toContain('req-search-1');
  });

  it('renders type-specific detail actions, unauthorized disabled state, and detail errors', () => {
    for (const kind of ['skill', 'mcp', 'plugin'] as ExtensionKind[]) {
      const html = renderToStaticMarkup(
        <ExtensionDetailDrawer
          detail={{ state: 'ready', item: extension(`${kind}-detail`, kind), versions: [{ version: '1.0.0' }] }}
          onClose={() => undefined}
          onPrimaryAction={() => undefined}
          onStar={() => undefined}
        />
      );
      expect(html).toContain(kind === 'skill' ? '启用 Skill' : kind === 'mcp' ? '接入 MCP' : '安装 Plugin');
    }

    const unauthorized = renderToStaticMarkup(
      <ExtensionDetailDrawer
        detail={{ state: 'ready', item: { ...extension('blocked-skill', 'skill'), authorized: false, authorizationMessage: '未授权' }, versions: [] }}
        onClose={() => undefined}
        onPrimaryAction={() => undefined}
        onStar={() => undefined}
      />
    );
    expect(unauthorized).toContain('disabled=""');
    expect(unauthorized).toContain('未授权');
    expect(unauthorized).toContain('当前版本 1.0.0，历史版本暂未加载');

    const failed = renderToStaticMarkup(
      <ExtensionDetailDrawer
        detail={{ state: 'error', item: extension('bad-skill', 'skill'), versions: [], error: { message: '详情失败', requestID: 'req-detail-1' } }}
        onClose={() => undefined}
        onPrimaryAction={() => undefined}
        onStar={() => undefined}
      />
    );
    expect(failed).toContain('详情加载失败');
    expect(failed).toContain('req-detail-1');

    const localFallback = renderToStaticMarkup(
      <ExtensionDetailDrawer
        detail={{ state: 'ready', source: 'local-fallback', item: { ...extension('local-skill', 'skill'), status: 'scanned', version: undefined, description: '本地状态：已扫描' }, versions: [] }}
        onClose={() => undefined}
        onPrimaryAction={() => undefined}
        onStar={() => undefined}
      />
    );
    expect(localFallback).toContain('本地记录');
    expect(localFallback).toContain('仅本地记录，未入库');
    expect(localFallback).not.toContain('启用 Skill');
    expect(localFallback).not.toContain('取消 Star');
  });

  it('falls back to local details for local-only auth and not-found records', () => {
    expect(shouldUseLocalDetailFallback({ ...extension('local-skill', 'skill'), status: 'installed' }, { code: 'unauthenticated', message: '登录已失效，请重新登录。' })).toBe(true);
    expect(shouldUseLocalDetailFallback({ ...extension('local-skill', 'skill'), status: 'scanned' }, { code: 'resource_not_found', message: '扩展不存在' })).toBe(true);
    expect(shouldUseLocalDetailFallback(extension('community-skill', 'skill'), { code: 'unauthenticated', message: '登录已失效，请重新登录。' })).toBe(false);
    expect(shouldUseLocalDetailFallback({ ...extension('local-skill', 'skill'), status: 'installed' }, { code: 'server_unavailable', message: '无法连接服务端，请检查网络或服务状态。' })).toBe(false);
  });

  it('renders the unified local resource page with offline warning and scope-reduced entries', () => {
    const html = renderView({
      activeTab: 'local',
      localTab: 'overview',
      offline: { online: false },
      lifecycle: {
        extensions: [{ extensionId: 'skill-one', name: 'Skill One', status: 'scope_reduced', updatedAt: '2026-05-25T00:00:00Z' }],
        versions: [],
        targets: [],
        tools: [],
        projects: [],
        mcpInstallations: [],
        pluginInstallations: [],
        resources: localResourceSnapshot()
      }
    });
    expect(html).toContain('当前离线');
    expect(html).toContain('重新扫描');
    expect(html).toContain('待同步事件 0');
    expect(html).toContain('Skill One');
    expect(html).toContain('名称');
    expect(html).toContain('智能体/项目');
    expect(html).not.toContain('SKILL_ENABLE');
    expect(html).toContain('授权收缩');
    expect(html).toContain('运行审计');
    expect(html).toContain('当前离线：新增服务端动作已暂停。');
    expect(html).not.toContain('当前仅展示已记录的统一审计摘要');
  });

  it('surfaces local resource snapshot failures instead of showing stale resources as ready', async () => {
    const current: EnterpriseAgentViewModel = {
      ...initialView(),
      activeTab: 'local',
      lifecycle: {
        ...initialView().lifecycle,
        resources: localResourceSnapshot()
      }
    };
    const outcome = await readLocalData({
      scanInventory: async () => ({
        scannedAt: '2026-06-15T00:00:00Z',
        discovered: { failures: 0, total: 0 }
      }),
      resources: async () => {
        throw new UiApiError({ code: 'local_resources_failed', message: '资源快照读取失败', requestID: 'req-resources' });
      }
    });
    const update = applyLocalLoadOutcome(current, outcome);

    expect(update.localScanState).toBe('error');
    expect(update.localScanError).toMatchObject({ code: 'local_resources_failed', message: '资源快照读取失败', requestID: 'req-resources' });
    expect(update.localScanSummary).toMatchObject({ scannedAt: '2026-06-15T00:00:00Z' });
    expect(update.lifecycle.resources?.rows).toHaveLength(0);

    const html = renderView({
      activeTab: 'local',
      localScanState: update.localScanState,
      localScanSummary: update.localScanSummary,
      localScanError: update.localScanError,
      lifecycle: update.lifecycle
    });
    expect(html).toContain('资源快照读取失败');
    expect(html).toContain('req-resources');
    expect(html).toContain('未发现可展示资源');
    expect(html).not.toContain('Skill One');
  });

  it('renders MCP variable warnings and manual-download instructions in action results', () => {
    const failedMcp = normalizeActionResult({
      plan: { operation: 'MCP_CONFIG_WRITE', summary: { title: 'Write MCP config' }, steps: [] },
      result: { status: 'success', steps: [{ stepId: 'write-mcp-config', action: 'json-upsert', status: 'success' }] },
      connectionTest: { status: 'unreachable', errorCode: 'http_health_unreachable' },
      rollbackResult: { status: 'success', steps: [{ stepId: 'remove-mcp-config', action: 'json-remove', status: 'success' }] }
    });
    expect(failedMcp.status).toBe('connection_test_failed');
    expect(failedMcp.warnings.join(' ')).toContain('MCP connection test failed');
    expect(failedMcp.steps.map((step) => step.stepId)).toEqual(expect.arrayContaining(['mcp-connection-test', 'remove-mcp-config']));

    const mcp = renderToStaticMarkup(
      <ExtensionActionModal
        item={extension('mcp-diff', 'mcp')}
        busy={false}
        result={{ status: 'dry_run', planTitle: 'Update MCP config', warnings: ['MCP variables added: newFlag', 'MCP variables removed: oldFlag'], steps: [] }}
        onClose={() => undefined}
        onRun={() => undefined}
      />
    );
    expect(mcp).toContain('MCP variables added: newFlag');
    expect(mcp).toContain('MCP variables removed: oldFlag');

    const plugin = renderToStaticMarkup(
      <ExtensionActionModal
        item={extension('plugin-manual', 'plugin')}
        busy={false}
        result={{ status: 'dry_run', warnings: ['manual-download uses controlled download and does not auto-install'], steps: [], manualInstructions: 'Open the zip from the internal share.', manualInstructionsUrl: 'http://intranet/plugins/manual' }}
        onClose={() => undefined}
        onRun={() => undefined}
      />
    );
    expect(plugin).toContain('目标工具');
    expect(plugin).toContain('Open the zip from the internal share.');
    expect(plugin).toContain('http://intranet/plugins/manual');
  });

  it('previews Skill enable targets and exposes post-action path helpers', () => {
    const html = renderToStaticMarkup(
      <ExtensionActionModal
        item={extension('skill-one', 'skill')}
        busy={false}
        result={{
          status: 'success',
          planTitle: 'Enable Skill',
          artifactPath: '/tmp/skill-one.package',
          targetPath: '/Users/alice/.codex/skills/skill-one',
          warnings: [],
          steps: []
        }}
        onClose={() => undefined}
        onOpenLocal={() => undefined}
        onRun={() => undefined}
      />
    );
    expect(html).toContain('~/.codex/skills');
    expect(html).toContain('central-store/skill-one/1.0.0');
    expect(html).toContain('current.json 负责指向当前版本');
    expect(html).toContain('复制目标路径');
    expect(html).toContain('查看本地');
    expect(html).not.toContain('同步状态');
  });

  it('renders publish wizard steps, fixed form labels, success IDs, and failure errors', () => {
    const first = renderToStaticMarkup(<PublishWizard busy={false} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(first).toContain('类型与包');
    expect(first).toContain('Skill 表单');
    expect(first).toContain('MCP 表单');
    expect(first).toContain('Plugin 表单');
    expect(first).toContain('aria-label="打开步骤：元数据" disabled=""');
    expect(first).toContain('aria-label="打开步骤：确认提交" disabled=""');

    const policy = renderToStaticMarkup(<PublishWizard busy={false} initialStep={2} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(policy).toContain('仅授权范围可见');
    expect(policy).toContain('所有登录用户可见');

    const success = renderToStaticMarkup(<PublishWizard busy={false} initialStep={3} result={{ submissionId: 'sub-1', revisionId: 'rev-1', status: 'SUBMITTED' }} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(success).toContain('sub-1');
    expect(success).toContain('rev-1');

    const failed = renderToStaticMarkup(<PublishWizard busy={false} error={{ message: '提交失败', requestID: 'req-publish-1' }} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(failed).toContain('req-publish-1');
  });

  it('shows extension identity in my submissions', () => {
    const html = renderToStaticMarkup(
      <MySubmissionsDrawer
        state="ready"
        items={[{
          submissionId: 'sub-1',
          extensionType: 'SKILL',
          status: 'PENDING_REVIEW',
          createdAt: '2026-06-11T00:00:00Z',
          targetExtensionId: 'skill.target',
          extensionName: 'Target Skill'
        }]}
        onClose={() => undefined}
        onRefresh={() => undefined}
        onWithdraw={() => undefined}
      />
    );
    expect(html).toContain('Target Skill (skill.target)');
    expect(html).toContain('sub-1');
  });

  it('submits publish authorization scope from the current session department', async () => {
    const submittedPayloads: unknown[] = [];
    vi.stubGlobal('crypto', { randomUUID: () => 'publish-uuid' });
    vi.stubGlobal('FileReader', TestFileReader);
    vi.stubGlobal('window', {
      enterpriseAgent: {
        publish: {
          uploadPackage: vi.fn(async () => ({
            success: true,
            data: { tempUploadId: 'temp-upload-1', sha256: 'sha-1', uploadType: 'SKILL_PACKAGE' },
            requestID: 'req-upload'
          })),
          createSubmission: vi.fn(async (payload: unknown) => {
            submittedPayloads.push(payload);
            return {
              success: true,
              data: { submissionId: 'sub-1', revisionId: 'rev-1', status: 'SUBMITTED' },
              requestID: 'req-create'
            };
          })
        }
      }
    });

    let model: EnterpriseAgentViewModel = {
      ...initialView(),
      user: { username: 'alice', displayName: 'Alice', departmentId: 'dept-current' }
    };
    const setView: Parameters<typeof createEnterpriseAgentActions>[0]['setView'] = (updater) => {
      model = typeof updater === 'function' ? updater(model) : updater;
    };
    const actions = createEnterpriseAgentActions({
      view: model,
      setView,
      loadCommunity: async () => undefined,
      loadLocal: async () => undefined,
      loadNotifications: async () => undefined,
      refreshSubmissions: async () => undefined
    });

    await (actions.submitPublish(validPublishDraft()) as unknown as Promise<void>);

    expect(model.publishBusy).toBe(false);
    expect(model.publishError).toBeUndefined();
    expect(submittedPayloads).toHaveLength(1);
    expect((submittedPayloads[0] as { request: { authorizationScope: unknown } }).request.authorizationScope).toEqual({
      scopeType: 'DEPARTMENT_TREE',
      departments: [{ departmentId: 'dept-current', includeChildren: true }]
    });
  });

  it('renders update modal controls and update failure requestId', () => {
    const available = renderToStaticMarkup(<UpdateModal update={{ state: 'available', version: '2.0.0' }} busy={false} onClose={() => undefined} onCheck={() => undefined} onDownload={() => undefined} onCancel={() => undefined} onInstall={() => undefined} />);
    expect(available).toContain('下载');
    expect(available).toContain('取消');
    expect(available).toContain('disabled=""');

    const failed = renderToStaticMarkup(<UpdateModal update={{ state: 'available', error: { message: '更新失败', requestID: 'req-update-1' } }} busy={false} onClose={() => undefined} onCheck={() => undefined} onDownload={() => undefined} onCancel={() => undefined} onInstall={() => undefined} />);
    expect(failed).toContain('req-update-1');
  });

  it('passes remember-password state through login actions and clears remembered login', async () => {
    const login = vi.fn(async () => ({ success: true, data: { user: { id: 'user-1', username: 'alice', mustChangePassword: false } }, requestID: 'req_login' }));
    const clearRememberedLogin = vi.fn(async () => ({ success: true, data: { remembered: false, autoLogin: false }, requestID: 'req_clear' }));
    vi.stubGlobal('window', {
      enterpriseAgent: {
        auth: {
          login,
          clearRememberedLogin
        }
      }
    });
    let model: EnterpriseAgentViewModel = initialView();
    const setView: Parameters<typeof createEnterpriseAgentActions>[0]['setView'] = (updater) => {
      model = typeof updater === 'function' ? updater(model) : updater;
    };
    const actions = createEnterpriseAgentActions({
      view: model,
      setView,
      loadCommunity: async () => undefined,
      loadLocal: async () => undefined,
      loadNotifications: async () => undefined,
      refreshSubmissions: async () => undefined
    });

    await (actions.login('alice', 'Password#1', true) as unknown as Promise<void>);
    expect(login).toHaveBeenCalledWith('alice', 'Password#1', { rememberPassword: true }, expect.stringMatching(/^renderer_login_/));
    expect(model.rememberedLogin).toMatchObject({ remembered: true, username: 'alice', autoLogin: true });

    await (actions.clearRememberedLogin() as unknown as Promise<void>);
    expect(clearRememberedLogin).toHaveBeenCalled();
    expect(model.rememberedLogin).toEqual({ remembered: false, autoLogin: false });
  });

  it('offers light theme and resolves system theme from OS preference', () => {
    const settings = renderToStaticMarkup(
      <SettingsModal
        config={{ theme: 'system' }}
        busy={false}
        onClose={() => undefined}
        onSave={() => undefined}
        onChangePassword={() => undefined}
        onOpenUpdate={() => undefined}
        canChangePassword
      />
    );
    expect(settings).toContain('玻璃浅色');
    expect(settings).toContain('跟随系统');
    expect(resolveTheme('system', true)).toBe('glass-light');
    expect(resolveTheme('glass-dark', true)).toBe('glass-dark');
  });
});

function renderView(patch: Partial<EnterpriseAgentViewModel>): string {
  return renderToStaticMarkup(<EnterpriseAgentAppView model={{ ...initialView(), bootState: 'ready', user: { username: 'alice' }, modal: 'none', ...patch }} actions={actions()} />);
}

function actions(): EnterpriseAgentActions {
  return {
    changeTab: () => undefined,
    changeLocalTab: () => undefined,
    refreshLocal: () => undefined,
    backToCommunity: () => undefined,
    search: () => undefined,
    openDetail: () => undefined,
    closeDetail: () => undefined,
    star: () => undefined,
    openAction: () => undefined,
    closeAction: () => undefined,
    runAction: () => undefined,
    openModal: () => undefined,
    closeModal: () => undefined,
    login: () => undefined,
    clearRememberedLogin: () => undefined,
    logout: () => undefined,
    saveSettings: () => undefined,
    changePassword: () => undefined,
    checkUpdate: () => undefined,
    downloadUpdate: () => undefined,
    cancelUpdate: () => undefined,
    installUpdate: () => undefined,
    submitPublish: () => undefined,
    refreshSubmissions: () => undefined,
    withdrawSubmission: () => undefined,
    markNotificationRead: () => undefined,
    requestCleanup: () => undefined,
    confirmCleanup: () => undefined
  };
}

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL(_file: Blob): void {
    this.result = 'data:application/zip;base64,U0tJTEw=';
    this.onload?.({} as ProgressEvent<FileReader>);
  }
}

function validPublishDraft(): PublishDraft {
  return {
    extensionType: 'skill',
    extensionId: 'dept-skill',
    version: '1.0.0',
    name: 'Dept Skill',
    summary: 'Dept scoped skill',
    visibilityMode: 'AUTHORIZED_ONLY',
    authorizationScope: 'DEPARTMENT_TREE',
    riskStatement: 'Reviewed risk statement.',
    file: { name: 'dept-skill.zip', type: 'application/zip' } as File
  };
}

function extension(id: string, type: ExtensionKind): ExtensionSummary {
  return {
    id,
    type,
    name: id,
    summary: `${id} summary`,
    version: '1.0.0',
    tags: [],
    authorized: true,
    starCount: 1
  };
}

function localResourceSnapshot(): LocalResourceSnapshot {
  const generatedAt = '2026-06-15T00:00:00Z';
  const resource = {
    id: 'resource_skill_one',
    type: LocalResourceTypes.SKILL,
    name: 'Skill One',
    displayName: 'Skill One',
    sourceType: LocalResourceSourceTypes.CENTRAL_STORE,
    sourceId: 'skill-one',
    sourcePath: '/tmp/central-store/skills/skill-one',
    managed: true,
    centralStoreManaged: true,
    nativeDirectoryManaged: false,
    eaManagedFallback: false,
    permissionSummary: createEmptyPermissionSummary('未声明'),
    auditSummary: createNotAuditedSummary(AuditStatuses.NOT_AUDITED),
    createdAt: generatedAt,
    lastScannedAt: generatedAt,
    metadata: {}
  };
  const binding = {
    id: 'binding_skill_one',
    resourceId: resource.id,
    resourceType: LocalResourceTypes.SKILL,
    agentId: 'codex',
    scopeType: ResourceScopeTypes.AGENT_GLOBAL,
    targetPath: '/Users/alice/.codex/skills/skill-one',
    managedMode: 'SERVER_MANAGED' as const,
    writeMode: 'READ_ONLY' as const,
    detectionStatus: DetectionStatuses.DETECTED,
    lifecycleStatus: LifecycleStatuses.ENABLED,
    pathStatus: PathStatuses.OK,
    authStatus: AuthStatuses.AUTH_REVOKED,
    auditStatus: AuditStatuses.NOT_AUDITED,
    driftStatus: DriftStatuses.UNKNOWN,
    operationStatus: OperationStatuses.IDLE,
    syncStatus: SyncStatuses.LOCAL_ONLY,
    externalModified: false,
    drifted: false,
    metadata: {},
    updatedAt: generatedAt
  };
  return {
    resources: [resource],
    bindings: [binding],
    files: [],
    events: [],
    rows: [{
      resource,
      binding,
      files: [],
      events: [],
      status: aggregateResourceStatus(binding),
      scopeLabel: 'codex / 智能体全局'
    }],
    summary: {
      resourceCount: 1,
      bindingCount: 1,
      fileCount: 0,
      eventCount: 0,
      pendingSyncEvents: 0,
      failureCount: 0,
      lastScannedAt: generatedAt,
      generatedAt
    }
  };
}
