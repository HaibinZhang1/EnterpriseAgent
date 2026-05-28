import { useState } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { ExtensionCard } from '../features/catalog/ExtensionCard';
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
  return (
    <main className="page" aria-label="社区首页">
      <header className="page-header">
        <div className="page-title">
          <h1>社区</h1>
          <span className="muted">查找企业可授权的 Skill、MCP 和 Plugin。</span>
        </div>
        <div className="card-action-row">
          <Button onClick={onOpenSubmissions}>我的提交</Button>
          <Button tone="primary" disabled={offline} onClick={onOpenPublish}>发布</Button>
        </div>
      </header>

      <form className="search-form" onSubmit={(event) => { event.preventDefault(); onSearch(query); }}>
        <label className="field">
          <span>搜索扩展</span>
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索扩展关键词" />
        </label>
        <Button type="submit" tone="primary">搜索</Button>
      </form>

      {state === 'loading' ? <LoadingState label="正在加载社区榜单" /> : null}
      {state === 'error' ? <ErrorState error={error} /> : null}
      {state === 'ready' ? (
        <div className="grid">
          <RankingSection title="Skill 区域" items={home.skills} onOpen={onOpen} onStar={onStar} />
          <RankingSection title="MCP 区域" items={home.mcps} onOpen={onOpen} onStar={onStar} />
          <RankingSection title="Plugin 区域" items={home.plugins} onOpen={onOpen} onStar={onStar} />
          <RankingSection title="热门榜单" items={home.hot} onOpen={onOpen} onStar={onStar} />
        </div>
      ) : null}
    </main>
  );
}

function RankingSection({ title, items, onOpen, onStar }: { title: string; items: ExtensionSummary[]; onOpen: (item: ExtensionSummary) => void; onStar: (item: ExtensionSummary) => void }) {
  return (
    <section className="panel">
      <header className="section-header">
        <h2>{title}</h2>
        <span className="meta">{items.length} 项</span>
      </header>
      {items.length === 0 ? (
        <EmptyState title={`${title}暂无数据`} message="服务端暂未返回榜单内容。" />
      ) : (
        <div className="grid cols-3">
          {items.map((item) => <ExtensionCard key={`${title}-${item.id}`} item={item} onOpen={onOpen} onStar={onStar} />)}
        </div>
      )}
    </section>
  );
}
