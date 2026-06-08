import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalExtensionsPage } from '../src/renderer/pages/LocalExtensionsPage';
import type { LocalLifecycleSnapshot, PendingEvent } from '../src/renderer/types/desktop';

describe('local extensions page', () => {
  it('renders stable local skill controls without hover-only actions', () => {
    const html = renderToStaticMarkup(
      <LocalExtensionsPage
        snapshot={snapshot()}
        pendingEvents={pendingEvents()}
        offline={false}
        localScanState="ready"
        localScanSummary={{
          scannedAt: '2026-06-06T07:00:00Z',
          discovered: { skills: 1, mcpConfigs: 0, plugins: 0, tools: 0, projects: 0, total: 1 }
        }}
        onCleanup={() => undefined}
        onOpenDetail={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expect(html).toContain('aria-label="打开本地分类：Skills 技能"');
    expect(html).toContain('aria-label="筛选本地Skill 技能：异常"');
    expect(html).toContain('data-testid="local-rescan"');
    expect(html).toContain('data-testid="local-scan-summary"');
    expect(html).toContain('Skill 1');
    expect(html).not.toContain('MCP 0');
    expect(html).toContain('data-testid="local-detail-skill-one"');
    expect(html).toContain('查看详情');
    expect(html).toContain('data-testid="local-cleanup-skill-one"');
    expect(html).toContain('本地清理');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="展开 Skill One 的 1 个本地实例"');
  });

  it('keeps an explicit empty scan summary when nothing is discovered', () => {
    const html = renderToStaticMarkup(
      <LocalExtensionsPage
        snapshot={{ extensions: [], versions: [], targets: [], tools: [], projects: [], mcpInstallations: [], pluginInstallations: [] }}
        pendingEvents={[]}
        offline={false}
        localScanState="ready"
        localScanSummary={{ scannedAt: '2026-06-06T07:00:00Z', discovered: { total: 0 } }}
        onCleanup={() => undefined}
        onOpenDetail={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expect(html).toContain('未发现本地记录');
  });
});

function snapshot(): LocalLifecycleSnapshot {
  return {
    extensions: [
      { extensionId: 'skill-one', name: 'Skill One', summary: 'A local skill.', version: '1.0.0', status: 'scope_reduced', updatedAt: '2026-06-06T07:00:00Z' }
    ],
    versions: [{ extensionId: 'skill-one', version: '1.0.0' }],
    targets: [
      { id: 'target-one', extensionId: 'skill-one', target: '/Users/alice/.codex/skills/skill-one', status: 'enabled', metadata: { managed: true, kind: 'skill' } }
    ],
    tools: [],
    projects: [],
    mcpInstallations: [],
    pluginInstallations: []
  };
}

function pendingEvents(): PendingEvent[] {
  return [{ eventType: 'SKILL_ENABLE', extensionID: 'skill-one', status: 'queued' }];
}
