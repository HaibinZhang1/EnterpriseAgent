import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuditFindingDetailSection,
  FilePreviewSection,
  LocalEventDetailSection,
  LocalPage,
  LocalResourceDrawer,
  buildCustomAgentProfile,
  phase3OperationMessage,
  rowForEvent,
  staticAuditRunMessage,
  upsertAgentProfile
} from '../src/renderer/pages/LocalPage';
import {
  aggregateResourceStatus,
  AuthStatuses,
  AuditStatuses,
  DetectionStatuses,
  DriftStatuses,
  LifecycleStatuses,
  LocalResourceSourceTypes,
  LocalResourceTypes,
  OperationStatuses,
  PathStatuses,
  PermissionCategories,
  ResourceScopeTypes,
  SyncStatuses,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  type LocalResourceSnapshot
} from '../src/shared/local-resources';
import { AuditSeverities, EnterpriseAuditRuleIds, type AuditFindingRecord } from '../src/shared/local-audit';
import type { LocalTab } from '../src/renderer/types/desktop';

describe('local resource page', () => {
  function expectNoGlobalLocalFilterGrid(html: string) {
    expect(html).not.toContain('local-filter-grid');
    expect(html).not.toContain('筛选本地资源');
    expect(html).not.toContain('data-testid=\"local-filter-scope\"');
    expect(html).not.toContain('data-testid=\"local-filter-permission\"');
    expect(html).not.toContain('data-testid=\"local-filter-platform\"');
    expect(html).not.toContain('data-testid=\"local-filter-sync\"');
    expect(html).not.toContain('data-testid=\"local-filter-offline\"');
    expect(html).not.toContain('data-testid=\"local-filter-time\"');
  }

  function expectTestId(html: string, testId: string) {
    expect(html).toContain(`data-testid=\"${testId}\"`);
  }

  function extractTestIdRegion(html: string, testId: string): string {
    const marker = `data-testid=\"${testId}\"`;
    const start = html.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextRegion = html.indexOf('data-testid=\"local-', start + marker.length);
    return html.slice(start, nextRegion === -1 ? undefined : nextRegion);
  }

  function expectToolbarControlBudget(html: string, testId: string, maxControls = 4) {
    const region = extractTestIdRegion(html, testId);
    const controls = (region.match(/<(button|select|input|textarea)\b/g) ?? []).length;
    expect(controls).toBeLessThanOrEqual(maxControls);
  }


  it('removes stale local filter grid CSS so the old heavy filter card cannot return by style only', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/styles/app.css'), 'utf8');

    expect(css).not.toContain('.local-filter-grid');
    expect(css).not.toContain('filter-bar local-filter-grid');
    expect(css).toContain('.local-page-header');
    expect(css).toContain('.local-tab-toolbar');
    expect(css).toContain('.local-split-layout');
  });

  it('renders phase two navigation entries, unified fields, and disabled write operations', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={snapshot()}
        activeTab="extensions"
        offline={false}
        localScanState="ready"
        localScanSummary={{
          scannedAt: '2026-06-15T00:00:00Z',
          discovered: { skills: 1, mcpConfigs: 0, plugins: 0, tools: 0, projects: 0, failures: 0, total: 1 }
        }}
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expectNoGlobalLocalFilterGrid(html);
    expectTestId(html, 'local-extensions-toolbar');
    expectToolbarControlBudget(html, 'local-extensions-toolbar');
    for (const label of ['概览', '智能体', '扩展', '项目', '工具集', '审计与事件']) {
      expect(html).toContain(label);
    }
    for (const header of ['名称', '类型', '智能体/项目', '权限', '审计', '状态']) {
      expect(html).toContain(`<th>${header}</th>`);
    }
    expect(html).toContain('Weather Skill');
    expect(html).toContain('授权收缩');
    expect(html).toContain('未审计');
    expect(html).toContain('data-testid="local-detail-resource_skill_c2tpbGwud2VhdGhlcg-extension');
    expect(html).toContain('disabled=""');
    expect(html).toContain('当前展示真实扫描');
    expect(html).toContain('运行审计');
    expect(html).toContain('ExecutionPlan');
    expect(html).not.toContain('SKILL_ENABLE');
    expect(html).not.toContain('shell-command');
  });

  it('renders page-specific extension controls and project list/detail without the old global filter grid', () => {
    const extHtml = renderToStaticMarkup(
      <LocalPage
        snapshot={phase3Snapshot()}
        activeTab="extensions"
        offline={false}
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expectNoGlobalLocalFilterGrid(extHtml);
    expectTestId(extHtml, 'local-extensions-toolbar');
    expectToolbarControlBudget(extHtml, 'local-extensions-toolbar');
    for (const label of ['Skill', 'MCP', 'Plugin', 'Hook', 'CLI']) {
      expect(extHtml).toContain(label);
    }
    expect(extHtml).toContain('2 智能体 / 1 项目 / 2 绑定');
    expect(extHtml).toContain('多分布');
    expect(extHtml).toContain('<option value="codex">codex</option>');
    expect(extHtml).toContain('<option value="claude-code">claude-code</option>');
    expect(extHtml).toContain('CENTRAL_STORE');
    const extensionToolbar = extractTestIdRegion(extHtml, 'local-extensions-toolbar');
    expect(extensionToolbar).toContain('类型');
    expect(extensionToolbar).toContain('智能体');
    expect(extensionToolbar).toContain('来源');
    for (const unrelated of ['权限', '平台', '同步', '离线', '时间']) {
      expect(extensionToolbar).not.toContain(unrelated);
    }

    const projectHtml = renderToStaticMarkup(
      <LocalPage
        snapshot={phase3Snapshot()}
        activeTab="projects"
        offline={false}
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expectNoGlobalLocalFilterGrid(projectHtml);
    expectTestId(projectHtml, 'local-project-list');
    expectTestId(projectHtml, 'local-project-detail');
    expect(projectHtml.indexOf('data-testid="local-project-list"')).toBeLessThan(projectHtml.indexOf('data-testid="local-project-detail"'));
    for (const tabLabel of ['总览', '智能体', '设置', '规则', '记忆', '子智能体', 'Ignore', '扩展', 'Hook', 'CLI', '审计', '事件']) {
      expect(projectHtml).toContain(tabLabel);
    }
    expect(projectHtml).toContain('项目路径');
    expect(projectHtml).toContain('路径状态');
    expect(projectHtml).toContain('删除保护');
    expect(projectHtml).toContain('阻断删除');
    expect(projectHtml).toContain('路径异常');
    expect(projectHtml).toContain('不删除真实项目目录');
    expect(projectHtml).toContain('删除管理记录');
  });

  it('renders phase three Toolkit Kit detail with manifest resources, drift, and partial results', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={phase3KitSnapshot()}
        activeTab="toolkits"
        offline={false}
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    for (const header of ['名称', '类型', '智能体/项目', '权限', '审计', '状态']) {
      expect(html).toContain(`<th>${header}</th>`);
    }
    expect(html).toContain('Dev Kit');
    expect(html).toContain('包含资源');
    expect(html).toContain('权限汇总');
    expect(html).toContain('审计汇总');
    expect(html).toContain('应用分布');
    expect(html).toContain('授权收缩资源');
    expect(html).toContain('Hash 异常资源');
    expectNoGlobalLocalFilterGrid(html);
    expectTestId(html, 'local-toolkit-toolbar');
    expectToolbarControlBudget(html, 'local-toolkit-toolbar');
    expect(html).toContain('导入 Kit');
    expect(html).toContain('从智能体生成');
    expect(html).toContain('从项目生成');
    expect(html).not.toContain('KitManifest JSON');
    expect(html).not.toContain('data-testid="kit-workbench"');
    expect(html).toContain('kit.codex');
    expect(html).toContain('kit.project.alpha');
    for (const label of ['Skill', 'MCP', 'Plugin', 'Hook', 'CLI', '规则', '记忆', '子智能体', '配置', 'Ignore']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('2 智能体 / 1 项目');
    expect(html).toContain('授权收缩');
    expect(html).toContain('manifest Hash 与本地资源记录不一致');
    expect(html).toContain('部分成功');
    expect(html).toContain('Kit 操作');
    expect(html).not.toContain('CLI_EXECUTED');
    expect(html).not.toContain('HOOK_TRIGGERED');
  });

  it('keeps compact Kit entry points visible without expanding the full workbench by default', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={emptySnapshot()}
        activeTab="toolkits"
        offline
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expectNoGlobalLocalFilterGrid(html);
    expectTestId(html, 'local-toolkit-toolbar');
    expectToolbarControlBudget(html, 'local-toolkit-toolbar');
    expect(html).toContain('导入 Kit');
    expect(html).toContain('从智能体生成');
    expect(html).toContain('从项目生成');
    expect(html).toContain('暂无工具集资源');
    expect(html).not.toContain('KitManifest JSON');
    expect(html).not.toContain('data-testid="kit-workbench"');
  });

  it('renders real empty states for each new navigation entry', () => {
    for (const tab of ['overview', 'agents', 'extensions', 'projects', 'toolkits', 'audit-events'] as LocalTab[]) {
      const html = renderToStaticMarkup(
        <LocalPage
          snapshot={emptySnapshot()}
          activeTab={tab}
          offline={false}
          localScanState="ready"
          localScanSummary={{ scannedAt: '2026-06-15T00:00:00Z', discovered: { failures: 0, total: 0 } }}
          onChangeTab={() => undefined}
          onRefreshLocal={() => undefined}
        />
      );
      if (tab === 'agents') {
        expect(html).toContain('Claude Code');
        expect(html).toContain('自定义目录');
        expect(html).toContain('未配置路径规则');
      } else {
        expect(html).toContain('暂无');
        expect(html).toContain(tab === 'overview' ? '未发现可展示资源' : '真实本地资源');
      }
    }
  });

  it('renders the full agent dashboard shell with built-ins, custom profile, and static Hook CLI boundaries', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={emptySnapshot()}
        activeTab="agents"
        offline={false}
        localScanState="ready"
        localScanSummary={{ scannedAt: '2026-06-15T00:00:00Z', discovered: { failures: 0, total: 0 } }}
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    for (const label of ['Claude Code', 'Codex', 'Gemini CLI', 'Cursor', 'Antigravity', 'Copilot', 'Windsurf', 'OpenCode', 'Hermes', '自定义目录']) {
      expect(html).toContain(label);
    }
    expectNoGlobalLocalFilterGrid(html);
    expectTestId(html, 'local-agent-list');
    expectTestId(html, 'local-agent-detail');
    expect(html.indexOf('data-testid="local-agent-list"')).toBeLessThan(html.indexOf('data-testid="local-agent-detail"'));
    const listRegion = html.slice(html.indexOf('data-testid="local-agent-list"'), html.indexOf('data-testid="local-agent-detail"'));
    expect(listRegion).toContain('agent-selector-row');
    expect(listRegion).not.toContain('<table');
    for (const tabLabel of ['总览', '设置', '规则', '子智能体', '记忆', '扩展', 'Hook', 'CLI', '文件', '审计', '事件']) {
      expect(html).toContain(tabLabel);
    }
    expect(html).toContain('macOS / Windows Path Profile');
    expect(html).toContain('Hook 和 CLI 只展示配置事件');
    expect(html).toContain('自定义路径');
    expect(html).toContain('添加自定义路径');
    expect(html).toContain('在扩展中查看');
    expect(html).not.toContain('data-testid="custom-agent-profile-form"');
    expect(html).not.toContain('HOOK_TRIGGERED');
    expect(html).not.toContain('CLI_EXECUTED');
  });

  it('renders multiple custom Agent Profiles from the shared resource snapshot', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={multipleCustomAgentSnapshot()}
        activeTab="agents"
        offline={false}
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expect(html).toContain('Custom One');
    expect(html).toContain('Custom Two');
    expect(html).toContain('custom-one');
    expect(html).toContain('custom-two');
  });

  it('keeps local tab toolbars isolated by active tab', () => {
    const tabs = [
      ['extensions', 'local-extensions-toolbar', ['local-audit-toolbar', 'local-agent-list', 'local-project-list', 'local-toolkit-toolbar']],
      ['audit-events', 'local-audit-toolbar', ['local-extensions-toolbar', 'local-agent-list', 'local-project-list', 'local-toolkit-toolbar']],
      ['agents', 'local-agent-list', ['local-extensions-toolbar', 'local-audit-toolbar', 'local-project-list', 'local-toolkit-toolbar']],
      ['projects', 'local-project-list', ['local-extensions-toolbar', 'local-audit-toolbar', 'local-agent-list', 'local-toolkit-toolbar']],
      ['toolkits', 'local-toolkit-toolbar', ['local-extensions-toolbar', 'local-audit-toolbar', 'local-agent-list', 'local-project-list']]
    ] as const;

    for (const [tab, expected, absent] of tabs) {
      const html = renderToStaticMarkup(
        <LocalPage
          snapshot={phase4AuditEventSnapshot()}
          activeTab={tab as LocalTab}
          offline={false}
          localScanState="ready"
          onChangeTab={() => undefined}
          onRefreshLocal={() => undefined}
        />
      );
      expectNoGlobalLocalFilterGrid(html);
      expectTestId(html, expected);
      for (const testId of absent) {
        expect(html).not.toContain(`data-testid="${testId}"`);
      }
    }
  });

  it('does not render search controls for agents, projects, or toolkits', () => {
    for (const [tab, removedLabel] of [
      ['agents', '搜索智能体'],
      ['projects', '搜索项目'],
      ['toolkits', '搜索工具集']
    ] as const) {
      const html = renderToStaticMarkup(
        <LocalPage
          snapshot={phase4AuditEventSnapshot()}
          activeTab={tab as LocalTab}
          offline={false}
          localScanState="ready"
          onChangeTab={() => undefined}
          onRefreshLocal={() => undefined}
        />
      );

      expect(html).not.toContain(removedLabel);
    }
  });

  it('does not leave count-only toolbars after removing agent and project search', () => {
    const agentHtml = renderToStaticMarkup(
      <LocalPage
        snapshot={phase4AuditEventSnapshot()}
        activeTab="agents"
        offline={false}
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );
    const projectHtml = renderToStaticMarkup(
      <LocalPage
        snapshot={phase4AuditEventSnapshot()}
        activeTab="projects"
        offline={false}
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expect(agentHtml).not.toContain('data-testid="local-agent-toolbar"');
    expect(projectHtml).not.toContain('data-testid="local-project-toolbar"');
  });

  it('preserves multiple custom Agent Profiles when unique IDs are saved', () => {
    expect(buildCustomAgentProfile({
      profileId: 'custom-directory',
      agentId: 'custom-directory',
      displayName: 'Reserved',
      rootPath: '/tmp/custom-directory',
      rulesText: JSON.stringify({ settings: ['/tmp/custom-directory/settings.json'] })
    })).toMatchObject({
      valid: false,
      error: expect.stringContaining('保留 ID')
    });

    const first = buildCustomAgentProfile({
      profileId: 'custom-one',
      agentId: 'custom-one',
      displayName: 'Custom One',
      rootPath: '/tmp/custom-one',
      rulesText: JSON.stringify({ settings: ['/tmp/custom-one/settings.json'] })
    });
    const second = buildCustomAgentProfile({
      profileId: 'custom-two',
      agentId: 'custom-two',
      displayName: 'Custom Two',
      rootPath: '/tmp/custom-two',
      rulesText: JSON.stringify({ settings: ['/tmp/custom-two/settings.json'] })
    });
    if (!first.valid) throw new Error(first.error);
    if (!second.valid) throw new Error(second.error);

    const profiles = upsertAgentProfile(upsertAgentProfile([], first.profile), second.profile);

    expect(profiles.map((item) => item.agentId)).toEqual(['custom-one', 'custom-two']);
    expect(profiles.map((item) => item.profileId)).toEqual(['custom-one', 'custom-two']);

    const codexProfile = buildCustomAgentProfile({
      profileId: 'custom-codex',
      agentId: 'custom-codex',
      targetAgentId: 'codex',
      displayName: 'Codex Custom',
      rootPath: '/tmp/codex-a',
      rulesText: JSON.stringify({ settings: ['/tmp/codex-a/config.toml'] })
    });
    const codexReplacement = buildCustomAgentProfile({
      profileId: 'custom-codex-replacement',
      agentId: 'custom-codex-replacement',
      targetAgentId: 'codex',
      displayName: 'Codex Replacement',
      rootPath: '/tmp/codex-b',
      rulesText: JSON.stringify({ settings: ['/tmp/codex-b/config.toml'] })
    });
    if (!codexProfile.valid) throw new Error(codexProfile.error);
    if (!codexReplacement.valid) throw new Error(codexReplacement.error);

    const attachedProfiles = upsertAgentProfile(upsertAgentProfile([], codexProfile.profile), codexReplacement.profile);

    expect(attachedProfiles).toHaveLength(1);
    expect(attachedProfiles[0]).toMatchObject({
      profileId: 'custom-codex-replacement',
      agentId: 'custom-codex-replacement',
      targetAgentId: 'codex'
    });
  });

  it('renders operation helper status without fake success for partial or failed results', () => {
    expect(staticAuditRunMessage({ audited: 4, findingCount: 2, failed: 1 })).toMatchObject({
      tone: 'error',
      text: expect.stringContaining('存在失败')
    });

    const partial = phase3OperationMessage({
      status: 'partial_success',
      message: 'Kit 应用完成但部分资源失败',
      resourceResults: [
        { status: 'success', message: '已记录 Kit 托管绑定。' },
        { status: 'failure', message: 'Kit 必需资源在本机不存在。' }
      ],
      failureReason: '必需资源缺失',
      suggestion: '重新导入 Kit 后再应用。'
    }, 'Kit 应用结果已按资源拆分记录。');
    expect(partial.tone).toBe('warn');
    expect(partial.text).toContain('部分成功');
    expect(partial.text).toContain('失败 1');
    expect(partial.text).toContain('必需资源缺失');

    const failed = phase3OperationMessage({
      status: 'failure',
      message: 'Kit 静态审计失败',
      resourceResults: [],
      failureReason: '静态审计阻断',
      suggestion: '修复风险后重试。'
    }, 'Kit 静态审计已写入本地事件。');
    expect(failed.tone).toBe('error');
    expect(failed.text).toContain('Kit 操作失败');
  });

  it('surfaces scan failures and local events from real snapshot data', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={failureSnapshot()}
        activeTab="audit-events"
        offline
        localScanState="error"
        localScanError={{ message: '本地扫描失败', requestID: 'req-scan' }}
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expect(html).toContain('本地扫描失败');
    expect(html).toContain('req-scan');
    expect(html).toContain('无法解析本地资源配置');
    expect(html).toContain('失败');
    expect(html).toContain('CONFIG_SCAN_FAILED');
    expect(html).toContain('当前离线');
  });

  it('renders phase four audit findings with page-specific audit controls only', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={phase4AuditEventSnapshot()}
        activeTab="audit-events"
        offline
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expectNoGlobalLocalFilterGrid(html);
    expectTestId(html, 'local-audit-toolbar');
    expectToolbarControlBudget(html, 'local-audit-toolbar');
    const auditToolbar = extractTestIdRegion(html, 'local-audit-toolbar');
    expect(auditToolbar).toContain('审计');
    for (const unrelated of ['权限', '平台', '同步', '离线', '时间']) {
      expect(auditToolbar).not.toContain(unrelated);
    }
    for (const header of ['名称', '类型', '智能体/项目', '权限', '审计', '状态']) {
      expect(html).toContain(`<th>${header}</th>`);
    }
    for (const label of ['配置', '规则', '记忆', '子智能体', 'Ignore', 'Skill', 'MCP', 'Plugin', 'Hook', 'CLI', 'Kit', '项目']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Phase4 Hook Risk');
    expect(html).toContain('规则 EA-AUD-006');
    expect(html).toContain('Trust 0');
    expect(html).toContain('阻断风险');
    expect(html).toContain('ROLLBACK_FAILED');
    expect(html).toContain('回滚失败');
    expect(html).toContain('PENDING_SYNC');
    expect(html).toContain('离线生成');
    expect(html).not.toContain('CLI_COMMAND_EXECUTED');
    expect(html).not.toContain('trigger-hook');
  });

  it('renders overview summary from the shared LocalResourceSnapshot', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={phase4AuditEventSnapshot()}
        activeTab="overview"
        offline
        localScanState="ready"
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expect(html).toContain('data-testid="local-overview-summary"');
    for (const label of ['智能体', '扩展', '项目', '工具集', '风险', '事件', '离线状态', '待同步']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('ROLLBACK_FAILED');
    expect(html).toContain('离线');
  });

  it('renders redacted file preview state and unavailable preview guidance', () => {
    const redacted = renderToStaticMarkup(
      <FilePreviewSection
        file={{
          path: '/tmp/settings.toml',
          contentType: 'toml',
          size: 42,
          previewAvailable: true,
          redactedPreview: 'api_key = "[REDACTED]"'
        } as any}
        preview={{ busy: false, tone: 'success', text: '文件预览已脱敏：toml / 42 bytes。', content: 'api_key = "[REDACTED]"' }}
        canPreview
        onPreview={() => undefined}
      />
    );
    expect(redacted).toContain('文件预览');
    expect(redacted).toContain('可预览');
    expect(redacted).toContain('[REDACTED]');

    const unavailable = renderToStaticMarkup(
      <FilePreviewSection
        file={{
          path: '/tmp/large.bin',
          contentType: 'binary',
          size: 300000,
          previewAvailable: false
        } as any}
        preview={{ busy: false, tone: 'error', text: '文件超过 256 KiB 预览限制。' }}
        canPreview
        onPreview={() => undefined}
      />
    );
    expect(unavailable).toContain('不可预览');
    expect(unavailable).toContain('文件超过 256 KiB 预览限制');
  });

  it('renders local event detail with reverse resource lookup', () => {
    const data = phase4AuditEventSnapshot();
    const event = data.events[0];
    const row = rowForEvent(data, event);

    expect(row?.resource.type).toBe(LocalResourceTypes.HOOK);

    const html = renderToStaticMarkup(<LocalEventDetailSection event={event} row={row} onOpenResource={() => undefined} />);
    expect(html).toContain('反查资源');
    expect(html).toContain('Format Hook');
    expect(html).toContain('Hook');
    expect(html).toContain('反查路径');
    expect(html).toContain('/tmp/phase4-8');
    expect(html).toContain('反查作用域');
    expect(html).toContain('project.alpha');
    expect(html).toContain('kit.dev');
    expect(html).toContain('打开关联资源');
  });

  it('resolves event reverse lookup to the exact binding before shared resource matches', () => {
    const data = phase3Snapshot();
    const skill = data.resources.find((resource) => resource.sourceId === 'skill.weather');
    const event = {
      eventId: 'event-skill-claude',
      idempotencyKey: 'event-skill-claude',
      eventType: 'PATH_CHECKED',
      resourceId: skill?.id,
      bindingId: 'binding_skill-claude',
      resourceType: LocalResourceTypes.SKILL,
      agentId: 'claude-code',
      projectId: 'project.alpha',
      status: 'success',
      message: '路径检查完成',
      offlineCreated: true,
      syncStatus: SyncStatuses.PENDING_SYNC,
      createdAt: '2026-06-15T00:00:00Z',
      metadata: {}
    } as any;

    const row = rowForEvent(data, event);

    expect(row?.binding?.id).toBe('binding_skill-claude');
    expect(row?.binding?.agentId).toBe('claude-code');
  });

  it('renders drawer jumps for binding distribution and audit findings', () => {
    const data = phase3Snapshot();
    const row = data.rows.find((candidate) => candidate.binding?.id === 'binding_skill-codex');
    expect(row).toBeDefined();

    const drawerHtml = renderToStaticMarkup(
      <LocalResourceDrawer
        item={visibleItemForRow(row!)}
        snapshot={data}
        onSelectResource={() => undefined}
        onClose={() => undefined}
      />
    );
    expect(drawerHtml).toContain('打开绑定');
    expect(drawerHtml).toContain('claude-code');

    const auditData = phase4AuditEventSnapshot();
    const finding = auditData.findings?.find((candidate) => candidate.resourceType === LocalResourceTypes.HOOK);
    const auditRow = auditData.rows.find((candidate) => candidate.binding?.id === finding?.bindingId);
    expect(finding).toBeDefined();
    const findingHtml = renderToStaticMarkup(
      <AuditFindingDetailSection
        finding={finding!}
        row={auditRow}
        events={auditData.events}
        onOpenResource={() => undefined}
      />
    );
    expect(findingHtml).toContain('打开关联资源');
  });
});

function snapshot(): LocalResourceSnapshot {
  const generatedAt = '2026-06-15T00:00:00Z';
  const resource = {
    id: 'resource_skill_c2tpbGwud2VhdGhlcg',
    type: LocalResourceTypes.SKILL,
    name: 'Weather Skill',
    displayName: 'Weather Skill',
    sourceType: LocalResourceSourceTypes.CENTRAL_STORE,
    sourceId: 'skill.weather',
    sourcePath: '/tmp/central-store/skills/weather',
    version: '1.2.3',
    managed: true,
    centralStoreManaged: true,
    nativeDirectoryManaged: false,
    eaManagedFallback: false,
    permissionSummary: createEmptyPermissionSummary('未声明'),
    auditSummary: createNotAuditedSummary(),
    createdAt: generatedAt,
    lastScannedAt: generatedAt,
    metadata: { source: 'local_inventory_scan' }
  };
  const binding = {
    id: 'binding_resource_skill_c2tpbGwud2VhdGhlcg_scope',
    resourceId: resource.id,
    resourceType: LocalResourceTypes.SKILL,
    agentId: 'codex',
    scopeType: ResourceScopeTypes.AGENT_GLOBAL,
    targetPath: '/Users/alice/.codex/skills/weather',
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
  const row = {
    resource,
    binding,
    files: [],
    events: [],
    status: aggregateResourceStatus(binding),
    scopeLabel: 'codex / 智能体全局'
  };
  return {
    resources: [resource],
    bindings: [binding],
    files: [],
    events: [],
    rows: [row],
    summary: { resourceCount: 1, bindingCount: 1, fileCount: 0, eventCount: 0, pendingSyncEvents: 0, failureCount: 0, lastScannedAt: generatedAt, generatedAt }
  };
}

function failureSnapshot(): LocalResourceSnapshot {
  const base = snapshot();
  const generatedAt = '2026-06-15T00:00:00Z';
  const resource = {
    ...base.resources[0],
    id: 'resource_skill_broken',
    name: '扫描失败：manifest.json',
    displayName: '扫描失败：manifest.json',
    sourceId: 'scan-failure',
    sourcePath: '/tmp/central-store/skills/broken/manifest.json',
    version: undefined,
    managed: false,
    centralStoreManaged: false
  };
  const binding = {
    ...base.bindings[0],
    id: 'binding_broken',
    resourceId: resource.id,
    detectionStatus: DetectionStatuses.SCAN_FAILED,
    lifecycleStatus: LifecycleStatuses.UNKNOWN,
    pathStatus: PathStatuses.UNKNOWN,
    authStatus: AuthStatuses.UNKNOWN,
    operationStatus: OperationStatuses.FAILURE,
    targetPath: '/tmp/central-store/skills/broken/manifest.json'
  };
  const event = {
    eventId: 'event-broken',
    idempotencyKey: 'local:broken',
    eventType: 'CONFIG_SCAN_FAILED',
    resourceId: resource.id,
    bindingId: binding.id,
    resourceType: LocalResourceTypes.SKILL,
    status: 'failure' as const,
    message: '无法解析本地资源配置',
    errorCode: 'manifest_parse_failed',
    failureReason: '无法解析本地资源配置',
    suggestion: '修复本地配置文件后重新扫描。',
    offlineCreated: true,
    syncStatus: SyncStatuses.LOCAL_ONLY,
    createdAt: generatedAt,
    metadata: {}
  };
  return {
    resources: [resource],
    bindings: [binding],
    files: [],
    events: [event],
    rows: [{ resource, binding, files: [], events: [event], status: aggregateResourceStatus(binding), scopeLabel: '自定义路径' }],
    summary: { resourceCount: 1, bindingCount: 1, fileCount: 0, eventCount: 1, pendingSyncEvents: 0, failureCount: 1, generatedAt }
  };
}

function emptySnapshot(): LocalResourceSnapshot {
  return {
    resources: [],
    bindings: [],
    files: [],
    events: [],
    rows: [],
    summary: { resourceCount: 0, bindingCount: 0, fileCount: 0, eventCount: 0, pendingSyncEvents: 0, failureCount: 0, generatedAt: '2026-06-15T00:00:00Z' }
  };
}

function phase3Snapshot(): LocalResourceSnapshot {
  const generatedAt = '2026-06-15T00:00:00Z';
  const project = resourceRecord(LocalResourceTypes.PROJECT, 'project.alpha', 'Alpha Project', {
    sourceType: LocalResourceSourceTypes.PROJECT_DIRECTORY,
    sourcePath: '/tmp/missing-alpha',
    permissionLabel: '项目路径'
  });
  const projectBinding = bindingRecord(project, 'project-binding', {
    projectId: 'project.alpha',
    scopeType: ResourceScopeTypes.PROJECT,
    targetPath: '/tmp/missing-alpha',
    pathStatus: PathStatuses.MISSING
  });
  const resources = [
    project,
    resourceRecord(LocalResourceTypes.SKILL, 'skill.weather', 'Weather Skill', { platform: 'macos', sourceType: LocalResourceSourceTypes.CENTRAL_STORE }),
    resourceRecord(LocalResourceTypes.MCP_SERVER, 'mcp.files', 'Files MCP', { sourceType: LocalResourceSourceTypes.CENTRAL_STORE }),
    resourceRecord(LocalResourceTypes.PLUGIN, 'plugin.theme', 'Theme Plugin', { metadata: { installMode: 'MANAGED_PACKAGE' } }),
    resourceRecord(LocalResourceTypes.HOOK, 'hook.format', 'Format Hook'),
    resourceRecord(LocalResourceTypes.CLI_COMMAND, 'cli.deploy', 'Deploy CLI')
  ];
  const bindings = [
    projectBinding,
    bindingRecord(resources[1], 'skill-codex', { agentId: 'codex', projectId: 'project.alpha', scopeType: ResourceScopeTypes.AGENT_PROJECT, authStatus: AuthStatuses.AUTH_REVOKED }),
    bindingRecord(resources[1], 'skill-claude', { agentId: 'claude-code', projectId: 'project.alpha', scopeType: ResourceScopeTypes.AGENT_PROJECT, authStatus: AuthStatuses.AUTH_REVOKED }),
    bindingRecord(resources[2], 'mcp-codex', { agentId: 'codex', projectId: 'project.alpha', scopeType: ResourceScopeTypes.AGENT_PROJECT }),
    bindingRecord(resources[3], 'plugin-codex', { agentId: 'codex', projectId: 'project.alpha', scopeType: ResourceScopeTypes.AGENT_PROJECT }),
    bindingRecord(resources[4], 'hook-codex', { agentId: 'codex', projectId: 'project.alpha', scopeType: ResourceScopeTypes.AGENT_PROJECT }),
    bindingRecord(resources[5], 'cli-codex', { agentId: 'codex', projectId: 'project.alpha', scopeType: ResourceScopeTypes.AGENT_PROJECT })
  ];
  const rows = bindings.map((binding) => {
    const resource = resources.find((item) => item.id === binding.resourceId) ?? project;
    return { resource, binding, files: [], events: [], status: aggregateResourceStatus(binding), scopeLabel: `${binding.agentId ?? binding.projectId ?? '项目'} / ${binding.scopeType}` };
  });
  return {
    resources,
    bindings,
    files: [],
    events: [],
    rows,
    summary: { resourceCount: resources.length, bindingCount: bindings.length, fileCount: 0, eventCount: 0, pendingSyncEvents: 0, failureCount: 0, lastScannedAt: generatedAt, generatedAt }
  };
}

function visibleItemForRow(row: LocalResourceSnapshot['rows'][number]) {
  const resource = row.resource;
  return {
    id: `${resource.id}:${row.binding?.id ?? 'resource'}`,
    name: resource.displayName || resource.name,
    typeLabel: String(resource.type),
    type: resource.type,
    scopeLabel: row.scopeLabel,
    permissionLabel: resource.permissionSummary.label || '未声明',
    permissionCategories: resource.permissionSummary.categories,
    auditLabel: String(resource.auditSummary.status),
    auditStatus: resource.auditSummary.status,
    status: row.status,
    path: row.binding?.targetPath ?? resource.sourcePath,
    version: resource.version,
    hash: resource.sha256 ?? resource.packageHash,
    updatedAt: row.binding?.updatedAt ?? resource.lastScannedAt ?? resource.createdAt,
    source: resource.sourceType,
    row,
    agentId: row.binding?.agentId,
    agentIds: row.binding?.agentId ? [row.binding.agentId] : [],
    projectId: row.binding?.projectId,
    projectIds: row.binding?.projectId ? [row.binding.projectId] : [],
    kitId: row.binding?.kitId,
    platforms: []
  } as any;
}

function phase3KitSnapshot(): LocalResourceSnapshot {
  const generatedAt = '2026-06-15T00:00:00Z';
  const skill = {
    ...resourceRecord(LocalResourceTypes.SKILL, 'skill.weather', 'Weather Skill'),
    sha256: 'actual-skill-hash'
  };
  const mcp = resourceRecord(LocalResourceTypes.MCP_SERVER, 'mcp.files', 'Files MCP');
  const plugin = resourceRecord(LocalResourceTypes.PLUGIN, 'plugin.theme', 'Theme Plugin');
  const hook = resourceRecord(LocalResourceTypes.HOOK, 'hook.format', 'Format Hook');
  const cli = resourceRecord(LocalResourceTypes.CLI_COMMAND, 'cli.deploy', 'Deploy CLI');
  const rule = resourceRecord(LocalResourceTypes.RULE, 'rule.review', 'Review Rule');
  const memory = resourceRecord(LocalResourceTypes.MEMORY, 'memory.team', 'Team Memory');
  const subagent = resourceRecord(LocalResourceTypes.SUBAGENT, 'subagent.qa', 'QA Subagent');
  const settings = resourceRecord(LocalResourceTypes.AGENT_CONFIG, 'settings.codex', 'Codex Settings');
  const ignore = resourceRecord(LocalResourceTypes.IGNORE_FILE, 'ignore.codex', 'Codex Ignore');
  const manifest = {
    kitId: 'kit.dev',
    name: 'Dev Kit',
    version: '1.0.0',
    sourceType: 'imported',
    createdAt: generatedAt,
    supportedAgents: ['codex', 'claude-code'],
    supportedPlatforms: ['macos'],
    resources: [
      kitRef(skill, 'SKILL:skill.weather'),
      kitRef(mcp, 'MCP_SERVER:mcp.files'),
      kitRef(plugin, 'PLUGIN:plugin.theme'),
      kitRef(hook, 'HOOK:hook.format'),
      kitRef(cli, 'CLI_COMMAND:cli.deploy'),
      kitRef(rule, 'RULE:rule.review'),
      kitRef(memory, 'MEMORY:memory.team'),
      kitRef(subagent, 'SUBAGENT:subagent.qa'),
      kitRef(settings, 'AGENT_CONFIG:settings.codex'),
      kitRef(ignore, 'IGNORE_FILE:ignore.codex')
    ],
    permissionSummary: {
      ...createEmptyPermissionSummary('FILESYSTEM / NETWORK'),
      declared: true,
      categories: ['FILESYSTEM', 'NETWORK'],
      items: ['FILE_READ', 'NETWORK_DOMAIN'],
      details: []
    },
    auditSummary: {
      status: AuditStatuses.HIGH_RISK,
      trustScore: 61,
      findingCount: 2,
      criticalCount: 0,
      highCount: 1,
      message: 'Kit 组合权限需复核'
    },
    requiredAuthorizations: [],
    resourceHashes: { 'SKILL:skill.weather': 'expected-skill-hash' },
    dependencies: [],
    conflictPolicy: 'skip',
    rollbackPolicy: 'best-effort',
    metadata: {}
  };
  const kit = {
    ...resourceRecord(LocalResourceTypes.KIT, 'kit.dev', 'Dev Kit', { metadata: { kitManifest: manifest }, sourceType: LocalResourceSourceTypes.LOCAL_IMPORT }),
    version: '1.0.0'
  };
  const resources = [kit, skill, mcp, plugin, hook, cli, rule, memory, subagent, settings, ignore];
  const bindings = [
    bindingRecord(kit, 'kit-codex-project', {
      agentId: 'codex',
      projectId: 'project.alpha',
      kitId: 'kit.dev',
      scopeType: ResourceScopeTypes.AGENT_PROJECT,
      metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' }
    }),
    bindingRecord(kit, 'kit-claude-project', {
      agentId: 'claude-code',
      projectId: 'project.alpha',
      kitId: 'kit.dev',
      scopeType: ResourceScopeTypes.AGENT_PROJECT,
      metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' }
    }),
    bindingRecord(skill, 'kit-skill-codex', {
      agentId: 'codex',
      projectId: 'project.alpha',
      kitId: 'kit.dev',
      scopeType: ResourceScopeTypes.AGENT_PROJECT,
      authStatus: AuthStatuses.AUTH_REVOKED,
      metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' }
    }),
    bindingRecord(mcp, 'kit-mcp-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(plugin, 'kit-plugin-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(hook, 'kit-hook-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(cli, 'kit-cli-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(rule, 'kit-rule-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(memory, 'kit-memory-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(subagent, 'kit-subagent-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(settings, 'kit-settings-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } }),
    bindingRecord(ignore, 'kit-ignore-codex', { agentId: 'codex', projectId: 'project.alpha', kitId: 'kit.dev', scopeType: ResourceScopeTypes.AGENT_PROJECT, metadata: { managedByKitId: 'kit.dev', kitApplicationId: 'kit-app-alpha' } })
  ];
  const event = {
    eventId: 'event-kit-apply',
    idempotencyKey: 'kit:apply',
    eventType: 'KIT_APPLIED',
    resourceId: kit.id,
    bindingId: bindings[0].id,
    resourceType: LocalResourceTypes.KIT,
    kitId: 'kit.dev',
    agentId: 'codex',
    projectId: 'project.alpha',
    status: 'partial_success' as const,
    message: 'Kit 部分成功',
    offlineCreated: true,
    syncStatus: SyncStatuses.PENDING_SYNC,
    createdAt: generatedAt,
    metadata: {
      operationResult: {
        resourceResults: [
          { resourceRefId: 'SKILL:skill.weather', status: 'success', message: '已记录 Kit 托管绑定。' },
          { resourceRefId: 'MCP_SERVER:mcp.missing', status: 'failure', message: 'Kit 必需资源在本机不存在。' }
        ]
      }
    }
  };
  const rows = bindings.map((binding) => {
    const resource = resources.find((item) => item.id === binding.resourceId) ?? kit;
    return { resource, binding, files: [], events: resource.id === kit.id ? [event] : [], status: aggregateResourceStatus(binding), scopeLabel: `${binding.agentId ?? binding.projectId ?? binding.kitId ?? '工具集'} / ${binding.scopeType}` };
  });
  return {
    resources,
    bindings,
    files: [],
    events: [event],
    rows,
    summary: { resourceCount: resources.length, bindingCount: bindings.length, fileCount: 0, eventCount: 1, pendingSyncEvents: 1, failureCount: 0, lastScannedAt: generatedAt, generatedAt }
  };
}

function multipleCustomAgentSnapshot(): LocalResourceSnapshot {
  const generatedAt = '2026-06-15T00:00:00Z';
  const customOne = resourceRecord(LocalResourceTypes.AGENT, 'custom-one', 'Custom One', { sourceType: LocalResourceSourceTypes.CUSTOM_DIRECTORY });
  const customTwo = resourceRecord(LocalResourceTypes.AGENT, 'custom-two', 'Custom Two', { sourceType: LocalResourceSourceTypes.CUSTOM_DIRECTORY });
  const customOneBinding = bindingRecord(customOne, 'custom-one-root', { agentId: 'custom-one', targetPath: '/tmp/custom-one' });
  const customTwoBinding = bindingRecord(customTwo, 'custom-two-root', { agentId: 'custom-two', targetPath: '/tmp/custom-two' });
  const rows = [
    { resource: customOne, binding: customOneBinding, files: [], events: [], status: aggregateResourceStatus(customOneBinding), scopeLabel: 'Custom One / 自定义路径' },
    { resource: customTwo, binding: customTwoBinding, files: [], events: [], status: aggregateResourceStatus(customTwoBinding), scopeLabel: 'Custom Two / 自定义路径' }
  ];
  return {
    resources: [customOne, customTwo],
    bindings: [customOneBinding, customTwoBinding],
    files: [],
    events: [],
    rows,
    summary: { resourceCount: 2, bindingCount: 2, fileCount: 0, eventCount: 0, pendingSyncEvents: 0, failureCount: 0, generatedAt }
  };
}

function phase4AuditEventSnapshot(): LocalResourceSnapshot {
  const generatedAt = '2026-06-16T08:00:00Z';
  const resources = [
    resourceRecord(LocalResourceTypes.AGENT_CONFIG, 'settings.codex', 'Codex Settings'),
    resourceRecord(LocalResourceTypes.RULE, 'rule.review', 'Review Rule'),
    resourceRecord(LocalResourceTypes.MEMORY, 'memory.team', 'Team Memory'),
    resourceRecord(LocalResourceTypes.SUBAGENT, 'subagent.qa', 'QA Subagent'),
    resourceRecord(LocalResourceTypes.IGNORE_FILE, 'ignore.codex', 'Codex Ignore'),
    resourceRecord(LocalResourceTypes.SKILL, 'skill.weather', 'Weather Skill'),
    resourceRecord(LocalResourceTypes.MCP_SERVER, 'mcp.files', 'Files MCP'),
    resourceRecord(LocalResourceTypes.PLUGIN, 'plugin.theme', 'Theme Plugin'),
    resourceRecord(LocalResourceTypes.HOOK, 'hook.format', 'Format Hook'),
    resourceRecord(LocalResourceTypes.CLI_COMMAND, 'cli.deploy', 'Deploy CLI'),
    resourceRecord(LocalResourceTypes.KIT, 'kit.dev', 'Dev Kit'),
    resourceRecord(LocalResourceTypes.PROJECT, 'project.alpha', 'Alpha Project', { sourceType: LocalResourceSourceTypes.PROJECT_DIRECTORY })
  ];
  const bindings = resources.map((resource, index) => bindingRecord(resource, `phase4-${index}`, {
    agentId: resource.type === LocalResourceTypes.PROJECT ? undefined : 'codex',
    projectId: 'project.alpha',
    kitId: resource.type === LocalResourceTypes.KIT ? 'kit.dev' : undefined,
    scopeType: resource.type === LocalResourceTypes.PROJECT ? ResourceScopeTypes.PROJECT : ResourceScopeTypes.AGENT_PROJECT,
    auditStatus: resource.type === LocalResourceTypes.HOOK ? AuditStatuses.SECURITY_RISK : AuditStatuses.NEEDS_REVIEW
  }));
  const event = {
    eventId: 'event-rollback-failed',
    idempotencyKey: 'phase4:rollback_failed',
    eventType: 'ROLLBACK_FAILED',
    operationId: 'plan-phase4',
    executionId: 'execution-phase4',
    resourceId: resources[8].id,
    bindingId: bindings[8].id,
    resourceType: LocalResourceTypes.HOOK,
    agentId: 'codex',
    projectId: 'project.alpha',
    kitId: 'kit.dev',
    status: 'rollback_failed' as const,
    message: 'Hook 配置回滚失败',
    errorCode: 'rollback_failed',
    failureReason: '恢复父路径失败',
    suggestion: '检查备份记录后手动清理。',
    offlineCreated: true,
    syncStatus: SyncStatuses.PENDING_SYNC,
    createdAt: generatedAt,
    metadata: {}
  };
  const findings = resources.map((resource, index): AuditFindingRecord => ({
    id: `finding-${index}`,
    runId: 'audit-run-phase4',
    ruleId: resource.type === LocalResourceTypes.HOOK ? EnterpriseAuditRuleIds.DANGEROUS_COMMANDS : EnterpriseAuditRuleIds.BROAD_PERMISSIONS,
    harnessRuleId: resource.type === LocalResourceTypes.HOOK ? 'dangerous-commands' : 'broad-permissions',
    resourceId: resource.id,
    bindingId: bindings[index].id,
    resourceType: resource.type,
    agentId: bindings[index].agentId,
    projectId: bindings[index].projectId,
    kitId: bindings[index].kitId,
    severity: resource.type === LocalResourceTypes.HOOK ? AuditSeverities.CRITICAL : AuditSeverities.MEDIUM,
    auditStatus: resource.type === LocalResourceTypes.HOOK ? AuditStatuses.SECURITY_RISK : AuditStatuses.NEEDS_REVIEW,
    trustScoreImpact: resource.type === LocalResourceTypes.HOOK ? 100 : 8,
    permissionCategory: resource.type === LocalResourceTypes.HOOK ? PermissionCategories.SHELL : PermissionCategories.FILESYSTEM,
    pathSummary: `/redacted/${resource.sourceId}`,
    lineStart: 3,
    lineEnd: 4,
    snippetHash: `sha256:finding-${index}`,
    title: resource.type === LocalResourceTypes.HOOK ? 'Phase4 Hook Risk' : `Phase4 ${resource.displayName} Risk`,
    description: '静态审计发现需要复核的本地资源配置。',
    impactScope: { resourceId: resource.id, bindingId: bindings[index].id, agentId: bindings[index].agentId, projectId: bindings[index].projectId },
    remediation: '收窄权限并重新运行静态审计。',
    relatedEventIds: resource.type === LocalResourceTypes.HOOK ? [event.eventId] : [],
    metadata: {},
    detectedAt: generatedAt,
    blocker: resource.type === LocalResourceTypes.HOOK
  }));
  const rows = bindings.map((binding, index) => {
    const resource = resources[index];
    return {
      resource: {
        ...resource,
        auditSummary: {
          status: findings[index].auditStatus,
          trustScore: findings[index].blocker ? 0 : 92,
          findingCount: 1,
          criticalCount: findings[index].severity === AuditSeverities.CRITICAL ? 1 : 0,
          highCount: 0,
          lastAuditedAt: generatedAt,
          message: 'phase4 audit'
        }
      },
      binding,
      files: [],
      events: binding.id === event.bindingId ? [event] : [],
      findings: [findings[index]],
      status: aggregateResourceStatus({ ...binding, auditStatus: findings[index].auditStatus }),
      scopeLabel: `${binding.agentId ?? binding.projectId ?? binding.kitId ?? '本地'} / ${binding.scopeType}`
    };
  });
  return {
    resources,
    bindings,
    files: [],
    events: [event],
    findings,
    rows,
    summary: { resourceCount: resources.length, bindingCount: bindings.length, fileCount: 0, eventCount: 1, pendingSyncEvents: 1, failureCount: 1, generatedAt }
  };
}

function resourceRecord(type: LocalResourceTypes[keyof typeof LocalResourceTypes], sourceId: string, name: string, options: { sourceType?: LocalResourceSourceTypes[keyof typeof LocalResourceSourceTypes]; sourcePath?: string; permissionLabel?: string; platform?: string; metadata?: Record<string, unknown> } = {}) {
  const generatedAt = '2026-06-15T00:00:00Z';
  return {
    id: `resource_${type.toLowerCase()}_${sourceId.replace(/[^a-z0-9]+/gi, '_')}`,
    type,
    name,
    displayName: name,
    sourceType: options.sourceType ?? LocalResourceSourceTypes.LOCAL_IMPORT,
    sourceId,
    sourcePath: options.sourcePath ?? `/tmp/${sourceId}`,
    version: '1.0.0',
    managed: false,
    centralStoreManaged: options.sourceType === LocalResourceSourceTypes.CENTRAL_STORE,
    nativeDirectoryManaged: false,
    eaManagedFallback: false,
    permissionSummary: createEmptyPermissionSummary(options.permissionLabel ?? '未声明'),
    auditSummary: createNotAuditedSummary(),
    createdAt: generatedAt,
    lastScannedAt: generatedAt,
    metadata: { ...(options.metadata ?? {}), supportedPlatforms: options.platform ? [options.platform] : [] }
  };
}

function kitRef(resource: ReturnType<typeof resourceRecord>, refId: string) {
  return {
    refId,
    resourceType: resource.type as Exclude<LocalResourceTypes[keyof typeof LocalResourceTypes], typeof LocalResourceTypes.KIT | typeof LocalResourceTypes.PROJECT | typeof LocalResourceTypes.AGENT | typeof LocalResourceTypes.AUDIT_FINDING | typeof LocalResourceTypes.LOCAL_EVENT>,
    resourceId: resource.id,
    required: true,
    metadata: {}
  };
}

function bindingRecord(resource: ReturnType<typeof resourceRecord>, suffix: string, options: Partial<LocalResourceSnapshot['bindings'][number]> = {}) {
  const generatedAt = '2026-06-15T00:00:00Z';
  return {
    id: `binding_${suffix}`,
    resourceId: resource.id,
    resourceType: resource.type,
    agentId: options.agentId,
    projectId: options.projectId,
    kitId: options.kitId,
    scopeType: options.scopeType ?? ResourceScopeTypes.AGENT_GLOBAL,
    targetPath: options.targetPath ?? `/tmp/${suffix}`,
    managedMode: 'LOCAL_MANAGED' as const,
    writeMode: 'READ_ONLY' as const,
    detectionStatus: DetectionStatuses.DETECTED,
    lifecycleStatus: LifecycleStatuses.ENABLED,
    pathStatus: options.pathStatus ?? PathStatuses.OK,
    authStatus: options.authStatus ?? AuthStatuses.AUTH_CACHE_VALID,
    auditStatus: options.auditStatus ?? AuditStatuses.NOT_AUDITED,
    driftStatus: DriftStatuses.UNKNOWN,
    operationStatus: OperationStatuses.IDLE,
    syncStatus: SyncStatuses.LOCAL_ONLY,
    externalModified: false,
    drifted: false,
    currentHash: options.currentHash,
    lastKnownHash: options.lastKnownHash,
    metadata: options.metadata ?? {},
    updatedAt: generatedAt
  };
}
