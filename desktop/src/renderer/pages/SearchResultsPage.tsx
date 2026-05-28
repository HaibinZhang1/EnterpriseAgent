import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { ExtensionCard } from '../features/catalog/ExtensionCard';
import { groupByKind } from '../lib/normalize';
import type { ExtensionKind, ExtensionSummary, LoadState, UiError } from '../types/desktop';

const groups: Array<{ id: ExtensionKind; title: string }> = [
  { id: 'skill', title: 'Skill' },
  { id: 'mcp', title: 'MCP' },
  { id: 'plugin', title: 'Plugin' }
];

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
  const grouped = groupByKind(items);
  return (
    <main className="page" aria-label="搜索结果">
      <header className="page-header">
        <div className="page-title">
          <h1>搜索结果</h1>
          <span className="muted">关键词：{query || '全部'}</span>
        </div>
        <Button onClick={onBack}>返回社区</Button>
      </header>
      {state === 'loading' ? <LoadingState label="正在搜索" /> : null}
      {state === 'error' ? <ErrorState error={error} title="搜索失败" /> : null}
      {state === 'ready' && items.length === 0 ? <EmptyState title="没有搜索结果" message="服务端返回空结果，未生成示例卡片。" /> : null}
      {state === 'ready' && items.length > 0 ? (
        <div className="grid">
          {groups.map((group) => (
            <section key={group.id} className="panel">
              <header className="section-header">
                <h2>{group.title}</h2>
                <span className="meta">{grouped[group.id].length} 项</span>
              </header>
              {grouped[group.id].length === 0 ? (
                <EmptyState title={`${group.title} 为空`} />
              ) : (
                <div className="grid cols-3">
                  {grouped[group.id].map((item) => <ExtensionCard key={item.id} item={item} onOpen={onOpen} onStar={onStar} />)}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </main>
  );
}
