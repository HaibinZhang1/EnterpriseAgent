import { useState, useEffect } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { ExtensionCard } from '../features/catalog/ExtensionCard';
import { groupByKind } from '../lib/normalize';
import type { ExtensionKind, ExtensionSummary, LoadState, UiError } from '../types/desktop';

export function SearchResultsPage({
  query,
  state,
  items,
  error,
  onBack,
  onOpen,
  onStar
}: {
  query: string;
  state: LoadState;
  items: ExtensionSummary[];
  error?: UiError;
  onBack: () => void;
  onOpen: (item: ExtensionSummary) => void;
  onStar: (item: ExtensionSummary) => void;
}) {
  const getInitialTab = (q: string): ExtensionKind => {
    const lower = (q || '').toLowerCase();
    if (lower.includes('mcp')) return 'mcp';
    if (lower.includes('plugin') || lower.includes('插件')) return 'plugin';
    return 'skill';
  };

  const [activeTab, setActiveTab] = useState<ExtensionKind>(() => getInitialTab(query));

  const grouped = groupByKind(items);

  // Hook query change to auto active correct tab based on community portal redirection keywords
  useEffect(() => {
    setActiveTab(getInitialTab(query));
  }, [query]);

  const navItems: Array<{ id: ExtensionKind; label: string; icon: string; count: number }> = [
    { id: 'skill', label: 'Skills 技能库', icon: '⚡', count: grouped.skill.length },
    { id: 'mcp', label: 'MCP Server 服务', icon: '🔌', count: grouped.mcp.length },
    { id: 'plugin', label: 'Plugin 原生插件', icon: '⚙️', count: grouped.plugin.length }
  ];

  const activeGroupItems = grouped[activeTab] || [];
  const activeLabel = activeTab === 'skill' ? 'Skill' : activeTab === 'mcp' ? 'MCP' : 'Plugin';

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {state === 'loading' && (
        <div style={{ padding: '24px', flex: 1, display: 'grid', placeItems: 'center' }}>
          <LoadingState label="正在检索社区扩展..." />
        </div>
      )}
      {state === 'error' && (
        <div style={{ padding: '24px', flex: 1 }}>
          <ErrorState error={error} title="搜索失败" />
        </div>
      )}

      {state === 'ready' && (
        <div className="saas-layout" style={{ height: '100%', overflow: 'hidden' }}>
          {/* Left Glass Sidebar */}
          <aside className="saas-sidebar" style={{ height: '100%', overflowY: 'auto' }} aria-label="分类导航">
            <div className="saas-sidebar-header">扩展分类导航</div>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`saas-sidebar-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <span className="saas-sidebar-item-label">
                  <span style={{ fontSize: '13px', marginRight: '8px', opacity: 0.85 }}>{item.icon}</span>
                  {item.label}
                </span>
                <span className="saas-sidebar-item-badge">{item.count}</span>
              </button>
            ))}
          </aside>

          {/* Right Main Content */}
          <div className="saas-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px 24px' }}>

            {/* Saas Header with Integrated Back Button and Search Metadata */}
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>社区检索 {activeLabel} 结果</h2>
                <span className="muted" style={{ fontSize: '12px', marginTop: '4px', display: 'block' }}>
                  找到 {activeGroupItems.length} 个相关结果，关键词: “{query || '全部'}”
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Button onClick={onBack} style={{ minHeight: '28px', padding: '0 12px', fontSize: '12px', flexShrink: 0 }}>
                  返回社区
                </Button>
              </div>
            </header>

            {/* List View panel with independent scrollbar */}
            <div className="panel" style={{ flex: 1, overflowY: 'auto', padding: '16px', margin: 0, display: 'flex', flexDirection: 'column' }}>
              {activeGroupItems.length === 0 ? (
                <EmptyState
                  title={`无匹配的 ${activeLabel}`}
                  message={`在此分类下未找到与“${query}”相关的扩展。您可以尝试自由切换其它页签或输入新的词检索。`}
                />
              ) : (
                <div className="grid cols-3" style={{ flex: 1, margin: 0 }}>
                  {activeGroupItems.map((item) => (
                    <ExtensionCard
                      key={item.id}
                      item={item}
                      onOpen={onOpen}
                      onStar={onStar}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
