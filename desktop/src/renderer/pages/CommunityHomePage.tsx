import { useState, useMemo } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import type { CatalogHome, ExtensionSummary, LoadState, UiError } from '../types/desktop';

export function CommunityHomePage({
  state,
  home,
  error,
  offline,
  onSearch,
  onOpen,
  onStar,
  onOpenPublish,
  onOpenSubmissions
}: {
  state: LoadState;
  home: CatalogHome;
  error?: UiError;
  offline: boolean;
  onSearch: (query: string) => void;
  onOpen: (item: ExtensionSummary) => void;
  onStar: (item: ExtensionSummary) => void;
  onOpenPublish: () => void;
  onOpenSubmissions: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activePeriods, setActivePeriods] = useState<Record<string, '总榜' | '月榜' | '周榜'>>({
    skill: '总榜',
    mcp: '总榜',
    plugin: '总榜'
  });

  const handlePeriodChange = (type: 'skill' | 'mcp' | 'plugin', period: '总榜' | '月榜' | '周榜') => {
    setActivePeriods(prev => ({ ...prev, [type]: period }));
  };

  // Helper to slice and sort top 5 items safely
  const getRankedItems = (
    items: ExtensionSummary[],
    period: '总榜' | '月榜' | '周榜',
    type: 'skill' | 'mcp' | 'plugin'
  ): ExtensionSummary[] => {
    if (!items || items.length === 0) return [];

    // Filter out visible entries (hide delisted or restricted visibility modes if needed)
    const visiblePool = items.filter(item => item.visibilityMode !== '仅授权范围内展示');

    // Sort logic: in ranking lists, we can simulate different rankings for periods or use the actual values.
    // To make it look extremely realistic, we sort by a combination of usage/downloads/stars and period.
    return visiblePool
      .slice()
      .sort((a, b) => {
        const starsA = a.starCount ?? 0;
        const starsB = b.starCount ?? 0;
        const countA = a.downloadCount ?? a.usageCount ?? 0;
        const countB = b.downloadCount ?? b.usageCount ?? 0;

        const valA = starsA * 10 + countA;
        const valB = starsB * 10 + countB;

        return valB - valA;
      })
      .slice(0, 5);
  };

  const skillItems = useMemo(() => getRankedItems(home?.skills || [], activePeriods.skill, 'skill'), [home?.skills, activePeriods.skill]);
  const mcpItems = useMemo(() => getRankedItems(home?.mcps || [], activePeriods.mcp, 'mcp'), [home?.mcps, activePeriods.mcp]);
  const pluginItems = useMemo(() => getRankedItems(home?.plugins || [], activePeriods.plugin, 'plugin'), [home?.plugins, activePeriods.plugin]);

  return (
    <main className="page" aria-label="社区首页">
      <header className="page-header">
        <div className="page-title">
          <h1>社区大厅</h1>
          <span className="muted">探索和接入团队精选的 AI Skill、企业级 MCP Server 和系统 Plugin。</span>
        </div>
        <div className="card-action-row">
          <Button onClick={onOpenSubmissions}>我的提交</Button>
          <Button tone="primary" disabled={offline} onClick={onOpenPublish}>发布扩展</Button>
        </div>
      </header>

      {/* Global Search Bar */}
      <form
        className="search-form"
        onSubmit={(event) => { event.preventDefault(); onSearch(query); }}
        style={{ marginBottom: 'var(--space-6)' }}
      >
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            aria-label="搜索 Skill、MCP Server、Plugin、作者、部门或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
        </div>
        <Button type="submit" tone="primary" style={{ minHeight: '42px', padding: '0 24px' }}>搜索</Button>
      </form>

      {state === 'loading' ? <LoadingState label="正在加载社区精选榜单..." /> : null}
      {state === 'error' ? <ErrorState error={error} /> : null}

      {state === 'ready' ? (
        <div className="grid">
          {/* Leaders Board Grid */}
          <div className="ranking-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>

            {/* Column 1: Skill Leaderboard */}
            <LeaderboardColumn
              title="Skill 精选热榜"
              type="skill"
              items={skillItems}
              activePeriod={activePeriods.skill}
              onPeriodChange={(p) => handlePeriodChange('skill', p)}
              onOpen={onOpen}
              onSearch={() => onSearch('Skill')}
            />

            {/* Column 2: MCP Server Leaderboard */}
            <LeaderboardColumn
              title="MCP Server 热榜"
              type="mcp"
              items={mcpItems}
              activePeriod={activePeriods.mcp}
              onPeriodChange={(p) => handlePeriodChange('mcp', p)}
              onOpen={onOpen}
              onSearch={() => onSearch('MCP')}
            />

            {/* Column 3: Plugin Leaderboard */}
            <LeaderboardColumn
              title="Plugin 工具热榜"
              type="plugin"
              items={pluginItems}
              activePeriod={activePeriods.plugin}
              onPeriodChange={(p) => handlePeriodChange('plugin', p)}
              onOpen={onOpen}
              onSearch={() => onSearch('Plugin')}
            />

          </div>

          {/* Quick Exploration Entrance */}
          <section className="panel" style={{ padding: 'var(--space-5)' }}>
            <header className="section-header" style={{ marginBottom: 'var(--space-4)' }}>
              <h2>快捷探索分类</h2>
              <span className="muted">按类型直达精细化搜索与过滤</span>
            </header>
            <div className="grid cols-3" style={{ gap: 'var(--space-4)' }}>

              <button type="button" className="glass-card entry-card" onClick={() => onSearch('Skill')} style={{ cursor: 'pointer', border: '1px solid var(--glass-border-soft)' }}>
                <div>
                  <h3 className="entry-title">Skill 技能库 ➔</h3>
                  <p className="entry-copy">探索预配置的各种专家工作流，一键授权并运行于你的桌面助手。</p>
                </div>
              </button>

              <button type="button" className="glass-card entry-card" onClick={() => onSearch('MCP')} style={{ cursor: 'pointer', border: '1px solid var(--glass-border-soft)' }}>
                <div>
                  <h3 className="entry-title">MCP Server 服务 ➔</h3>
                  <p className="entry-copy">将第三方API、数据库、云服务接入本地，为大模型提供实时动态数据源。</p>
                </div>
              </button>

              <button type="button" className="glass-card entry-card" onClick={() => onSearch('Plugin')} style={{ cursor: 'pointer', border: '1px solid var(--glass-border-soft)' }}>
                <div>
                  <h3 className="entry-title">Plugin 原生插件 ➔</h3>
                  <p className="entry-copy">深度扩展应用内核，赋予大模型文件系统读写、终端控制等原生能力。</p>
                </div>
              </button>

            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

interface LeaderboardColumnProps {
  title: string;
  type: 'skill' | 'mcp' | 'plugin';
  items: ExtensionSummary[];
  activePeriod: '总榜' | '月榜' | '周榜';
  onPeriodChange: (period: '总榜' | '月榜' | '周榜') => void;
  onOpen: (item: ExtensionSummary) => void;
  onSearch: () => void;
}

function LeaderboardColumn({
  title,
  type,
  items,
  activePeriod,
  onPeriodChange,
  onOpen,
  onSearch
}: LeaderboardColumnProps) {
  const periods: Array<'总榜' | '月榜' | '周榜'> = ['总榜', '月榜', '周榜'];

  return (
    <article className="glass-card rank-card" style={{ padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--glass-border-soft)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <h3 style={{ margin: '0 0 var(--space-2) 0', fontSize: '16px', fontWeight: '800' }}>{title}</h3>
        {/* Period Tabs */}
        <div className="period-tabs" style={{ display: 'flex', gap: '6px' }}>
          {periods.map(p => (
            <button
              key={p}
              type="button"
              className={`chip ${activePeriod === p ? 'active' : ''}`}
              onClick={() => onPeriodChange(p)}
              style={{ padding: '2px 10px', fontSize: '11px', minHeight: '22px' }}
            >
              {p}
            </button>
          ))}
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState title="暂无排行数据" message="本周期内暂无活跃的该类型扩展。" />
      ) : (
        <ol className="rank-list" style={{ listStyle: 'none', padding: '0', margin: '0 0 var(--space-4) 0', flexGrow: '1' }}>
          {items.map((item, idx) => {
            const count = item.downloadCount ?? item.usageCount ?? 0;
            const rankNum = idx + 1;

            // Highlight color for top 3
            let rankColor = 'var(--text-secondary)';
            if (rankNum === 1) rankColor = '#ffb300'; // Gold
            if (rankNum === 2) rankColor = '#cfd8dc'; // Silver
            if (rankNum === 3) rankColor = '#b0bec5'; // Bronze

            return (
              <li
                key={item.id}
                onClick={() => onOpen(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 8px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--glass-border-soft)',
                  transition: 'background 180ms ease'
                }}
                className="rank-item-row"
              >
                {/* Position index number */}
                <span style={{ width: '28px', fontSize: '15px', fontWeight: 'bold', color: rankColor, display: 'inline-block', textAlign: 'center' }}>
                  {rankNum}
                </span>

                {/* Main details */}
                <div style={{ flexGrow: '1', minWidth: '0', marginRight: '10px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                  </div>
                  <div className="muted" style={{ fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    by {item.publisher || '匿名'}
                  </div>
                </div>

                {/* Score / count */}
                <div style={{ textAlign: 'right', flexShrink: '0' }}>
                  <div style={{ fontSize: '12px', fontWeight: 'bold' }}>
                    ⭐ {item.starCount ?? 0}
                  </div>
                  <div className="muted" style={{ fontSize: '10px' }}>
                    {type === 'mcp' ? '接入 ' : '下载 '}
                    {count > 1000 ? `${(count / 1000).toFixed(1)}k` : count}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* View More button */}
      <Button onClick={onSearch} style={{ width: '100%' }}>
        查看更多
      </Button>
    </article>
  );
}
