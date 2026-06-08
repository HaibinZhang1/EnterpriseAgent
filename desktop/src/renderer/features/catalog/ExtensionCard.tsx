import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { primaryActionLabel } from '../extension/ExtensionDetailDrawer';
import { extensionKindLabel, riskTone, statusLabel } from '../../lib/formatting';
import type { ExtensionSummary } from '../../types/desktop';

export function ExtensionCard({
  item,
  onOpen,
  onPrimaryAction,
  onStar,
  disabledStar
}: {
  item: ExtensionSummary;
  onOpen: (item: ExtensionSummary) => void;
  onPrimaryAction?: (item: ExtensionSummary) => void;
  onStar?: (item: ExtensionSummary) => void;
  disabledStar?: boolean;
}) {
  return (
    <Card className="extension-result-card">
      <div className="row-between">
        <div className="card-action-row compact">
          <StatusBadge tone="info">{extensionKindLabel(item.type)}</StatusBadge>
          {item.version ? <StatusBadge>v{item.version}</StatusBadge> : null}
          {item.status ? <StatusBadge tone={riskTone(item.status)}>{statusLabel(item.status)}</StatusBadge> : null}
        </div>
        <button type="button" className="icon-button" disabled={disabledStar} onClick={() => onStar?.(item)} aria-label={item.starred ? '取消 Star' : 'Star'}>
          {item.starred ? '★' : '☆'}
        </button>
      </div>
      <div>
        <h3>{item.name}</h3>
        <p className="muted">{item.summary ?? item.description ?? '暂无简介'}</p>
      </div>
      <div className="card-action-row">
        {item.publisher ? <span className="meta">{item.publisher}</span> : null}
        {item.riskLevel ? <StatusBadge tone={riskTone(item.riskLevel)}>{item.riskLevel}</StatusBadge> : null}
        <span className="meta">Star {item.starCount ?? 0}</span>
        <span className="meta">下载 {item.downloadCount ?? 0}</span>
        {item.usageCount !== undefined ? <span className="meta">使用 {item.usageCount}</span> : null}
      </div>
      <div className="card-action-row">
        {onPrimaryAction ? <Button tone="primary" disabled={item.authorized === false} onClick={() => onPrimaryAction(item)}>{primaryActionLabel(item)}</Button> : null}
        <Button tone={onPrimaryAction ? 'ghost' : undefined} onClick={() => onOpen(item)}>查看详情</Button>
      </div>
    </Card>
  );
}
