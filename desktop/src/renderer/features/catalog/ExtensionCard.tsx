import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { extensionKindLabel, riskTone, statusLabel } from '../../lib/formatting';
import type { ExtensionSummary } from '../../types/desktop';

export function ExtensionCard({
  item,
  onOpen,
  onStar,
  disabledStar
}: {
  item: ExtensionSummary;
  onOpen: (item: ExtensionSummary) => void;
  onStar?: (item: ExtensionSummary) => void;
  disabledStar?: boolean;
}) {
  return (
    <Card>
      <div className="row-between">
        <StatusBadge tone="info">{extensionKindLabel(item.type)}</StatusBadge>
        <button type="button" className="icon-button" disabled={disabledStar} onClick={() => onStar?.(item)} aria-label={item.starred ? '取消 Star' : 'Star'}>
          {item.starred ? '★' : '☆'}
        </button>
      </div>
      <div>
        <h3>{item.name}</h3>
        <p className="muted">{item.summary ?? item.description ?? '暂无简介'}</p>
      </div>
      <div className="card-action-row">
        {item.version ? <StatusBadge>v{item.version}</StatusBadge> : null}
        {item.riskLevel ? <StatusBadge tone={riskTone(item.riskLevel)}>{item.riskLevel}</StatusBadge> : null}
        {item.status ? <StatusBadge tone={riskTone(item.status)}>{statusLabel(item.status)}</StatusBadge> : null}
      </div>
      <div className="card-action-row">
        <span className="meta">Star {item.starCount ?? 0}</span>
        <span className="meta">下载 {item.downloadCount ?? 0}</span>
        <span className="meta">使用 {item.usageCount ?? 0}</span>
      </div>
      <Button onClick={() => onOpen(item)}>查看详情</Button>
    </Card>
  );
}
