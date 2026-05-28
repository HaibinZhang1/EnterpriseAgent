import { Button } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { StatusBadge } from '../../components/StatusBadge';
import { extensionKindLabel, riskTone, statusLabel } from '../../lib/formatting';
import type { DetailState, ExtensionSummary } from '../../types/desktop';

export function ExtensionDetailDrawer({
  detail,
  onClose,
  onPrimaryAction,
  onStar
}: {
  detail: DetailState;
  onClose: () => void;
  onPrimaryAction: (item: ExtensionSummary) => void;
  onStar: (item: ExtensionSummary) => void;
}) {
  const item = detail.item;
  return (
    <Drawer title={item?.name ?? '扩展详情'} onClose={onClose}>
      {detail.state === 'loading' ? <LoadingState label="正在加载详情" /> : null}
      {detail.state === 'error' ? <ErrorState error={detail.error} title="详情加载失败" /> : null}
      {detail.state === 'ready' && item ? (
        <>
          <section className="grid">
            <div className="card-action-row">
              <StatusBadge tone="info">{extensionKindLabel(item.type)}</StatusBadge>
              {item.status ? <StatusBadge tone={riskTone(item.status)}>{statusLabel(item.status)}</StatusBadge> : null}
              {item.riskLevel ? <StatusBadge tone={riskTone(item.riskLevel)}>{item.riskLevel}</StatusBadge> : null}
            </div>
            <p>{item.description ?? item.summary ?? '暂无详情描述。'}</p>
            {item.authorizationMessage ? <ErrorState title="权限提示" error={{ message: item.authorizationMessage }} /> : null}
            <div className="card-action-row">
              <Button tone="primary" disabled={item.authorized === false} onClick={() => onPrimaryAction(item)}>
                {primaryActionLabel(item)}
              </Button>
              <Button onClick={() => onStar(item)}>{item.starred ? '取消 Star' : 'Star'}</Button>
            </div>
          </section>

          <section className="panel">
            <header className="section-header">
              <h2>版本</h2>
              <span className="meta">{detail.versions.length} 个版本</span>
            </header>
            {detail.versions.length === 0 ? <EmptyState title="暂无版本信息" /> : (
              <table className="table">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>状态</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.versions.map((version) => (
                    <tr key={version.version}>
                      <td>{version.version}</td>
                      <td>{version.status ?? '-'}</td>
                      <td>{version.createdAt ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </Drawer>
  );
}

export function primaryActionLabel(item: ExtensionSummary): string {
  if (item.type === 'skill') return '启用 Skill';
  if (item.type === 'mcp') return '接入 MCP';
  return '安装 Plugin';
}
