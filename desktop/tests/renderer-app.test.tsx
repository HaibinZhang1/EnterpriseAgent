import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnterpriseAgentAppView, initialView, normalizeActionResult, resolveTheme, type EnterpriseAgentActions, type EnterpriseAgentViewModel } from '../src/renderer/App';
import { ExtensionActionModal } from '../src/renderer/features/extension/ExtensionActionModal';
import { ExtensionDetailDrawer } from '../src/renderer/features/extension/ExtensionDetailDrawer';
import { PublishWizard } from '../src/renderer/features/publish/PublishWizard';
import { SettingsModal } from '../src/renderer/features/settings/SettingsModal';
import { UpdateModal } from '../src/renderer/features/update/UpdateModal';
import type { ExtensionKind, ExtensionSummary } from '../src/renderer/types/desktop';

describe('renderer app view', () => {
  it('shows login entry before auth and Agent home after auth with fixed desktop tabs', () => {
    const unauthenticated = renderView({ modal: 'login' });
    expect(unauthenticated).toContain('登录 Enterprise Agent Hub');
    expect(unauthenticated).toContain('Agent');
    expect(unauthenticated).toContain('社区');
    expect(unauthenticated).toContain('本地');

    const authenticated = renderView({ user: { username: 'alice', displayName: 'Alice' }, modal: 'none', bootState: 'ready' });
    expect(authenticated).toContain('Agent 工作台');
    expect(authenticated).toContain('当前账号：Alice');
  });

  it('allows unauthenticated users to dismiss the login modal and keep the shell visible', () => {
    const dismissed = renderView({ user: undefined, modal: 'none', bootState: 'ready' });
    expect(dismissed).not.toContain('<h2>登录 Enterprise Agent Hub</h2>');
    expect(dismissed).toContain('Agent 工作台');
    expect(dismissed).toContain('请登录后使用企业扩展能力');
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
  });

  it('shows local pending events, offline server-action warning, and cleanup for scope-reduced entries', () => {
    const html = renderView({
      activeTab: 'local',
      offline: { online: false },
      pendingEvents: [{ eventType: 'SKILL_ENABLE', extensionID: 'skill-one', status: 'queued' }],
      lifecycle: {
        extensions: [{ extensionId: 'skill-one', name: 'Skill One', status: 'scope_reduced', updatedAt: '2026-05-25T00:00:00Z' }],
        versions: [],
        targets: [],
        tools: [],
        projects: [],
        mcpInstallations: [],
        pluginInstallations: []
      }
    });
    expect(html).toContain('当前离线');
    expect(html).toContain('重新扫描');
    expect(html).toContain('SKILL_ENABLE');
    expect(html).toContain('授权收缩');
    expect(html).toContain('本地清理');
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

  it('renders publish wizard steps, fixed form labels, success IDs, and failure errors', () => {
    const first = renderToStaticMarkup(<PublishWizard busy={false} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(first).toContain('类型与包');
    expect(first).toContain('Skill 表单');
    expect(first).toContain('MCP 表单');
    expect(first).toContain('Plugin 表单');

    const policy = renderToStaticMarkup(<PublishWizard busy={false} initialStep={2} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(policy).toContain('仅授权范围可见');
    expect(policy).toContain('所有登录用户可见');

    const success = renderToStaticMarkup(<PublishWizard busy={false} initialStep={3} result={{ submissionId: 'sub-1', revisionId: 'rev-1', status: 'SUBMITTED' }} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(success).toContain('sub-1');
    expect(success).toContain('rev-1');

    const failed = renderToStaticMarkup(<PublishWizard busy={false} error={{ message: '提交失败', requestID: 'req-publish-1' }} onClose={() => undefined} onSubmit={() => undefined} />);
    expect(failed).toContain('req-publish-1');
  });

  it('renders update modal controls and update failure requestId', () => {
    const available = renderToStaticMarkup(<UpdateModal update={{ state: 'available', version: '2.0.0' }} busy={false} onClose={() => undefined} onCheck={() => undefined} onDownload={() => undefined} onCancel={() => undefined} onInstall={() => undefined} />);
    expect(available).toContain('下载');
    expect(available).toContain('取消');
    expect(available).toContain('disabled=""');

    const failed = renderToStaticMarkup(<UpdateModal update={{ state: 'available', error: { message: '更新失败', requestID: 'req-update-1' } }} busy={false} onClose={() => undefined} onCheck={() => undefined} onDownload={() => undefined} onCancel={() => undefined} onInstall={() => undefined} />);
    expect(failed).toContain('req-update-1');
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
