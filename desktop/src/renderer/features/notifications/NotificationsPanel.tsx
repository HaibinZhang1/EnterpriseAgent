import { Button } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import { compactDate, riskTone } from '../../lib/formatting';
import type { NotificationItem } from '../../types/desktop';

export function NotificationsPanel({ items, onClose, onRead }: { items: NotificationItem[]; onClose: () => void; onRead: (id: string) => void }) {
  return (
    <Drawer title="通知" onClose={onClose}>
      {items.length === 0 ? <EmptyState title="暂无通知" /> : (
        <div className="grid">
          {items.map((item) => (
            <article key={item.id} className="card">
              <div className="section-header">
                <h3>{item.title}</h3>
                <StatusBadge tone={item.read ? 'ok' : riskTone(item.severity) ?? 'info'}>{item.read ? '已读' : '未读'}</StatusBadge>
              </div>
              {item.message ? <p className="muted">{item.message}</p> : null}
              <div className="row-between">
                <span className="meta">{compactDate(item.createdAt)}</span>
                {!item.read ? <Button onClick={() => onRead(item.id)}>标为已读</Button> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </Drawer>
  );
}
