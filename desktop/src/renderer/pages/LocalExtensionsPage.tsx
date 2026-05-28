import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { asText, compactDate, riskTone, statusLabel } from '../lib/formatting';
import type { LocalLifecycleSnapshot, PendingEvent } from '../types/desktop';

export function LocalExtensionsPage({
  snapshot,
  pendingEvents,
  offline,
  onCleanup
}: {
  snapshot: LocalLifecycleSnapshot;
  pendingEvents: PendingEvent[];
  offline: boolean;
  onCleanup: (row: Record<string, unknown>) => void;
}) {
  const rows = snapshot.extensions;
  const targetRows = [
    ...snapshot.targets.map((row) => ({ ...row, localKind: 'skill' })),
    ...snapshot.mcpInstallations.map((row) => ({ ...row, localKind: 'mcp' })),
    ...snapshot.pluginInstallations.map((row) => ({ ...row, localKind: 'plugin' }))
  ];
  return (
    <section className="grid" aria-label="本地已安装扩展">
      <div className="panel">
        <header className="section-header">
          <h2>已安装扩展</h2>
          <StatusBadge tone={offline ? 'warn' : 'ok'}>{offline ? '离线查看' : '在线'}</StatusBadge>
        </header>
        {rows.length === 0 ? <EmptyState title="暂无本地扩展" message="已扫描受控本地目录，未发现已缓存或已安装扩展。" /> : (
          <table className="table">
            <thead>
              <tr>
                <th>扩展</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={asText(row.extensionId)}>
                  <td>
                    <strong>{asText(row.name ?? row.extensionId)}</strong>
                    <div className="muted">{asText(row.summary, '暂无简介')}</div>
                  </td>
                  <td><StatusBadge tone={riskTone(String(row.status ?? ''))}>{statusLabel(asText(row.status))}</StatusBadge></td>
                  <td>{compactDate(asText(row.updatedAt, ''))}</td>
                  <td>
                    <Button onClick={() => onCleanup(row)} tone="danger">本地清理</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <PendingEventsPanel events={pendingEvents} />
      <TargetsPanel rows={targetRows} onCleanup={onCleanup} />
    </section>
  );
}

function PendingEventsPanel({ events }: { events: PendingEvent[] }) {
  return (
    <div className="panel">
      <header className="section-header">
        <h2>本地事件</h2>
        <span className="meta">{events.length} 条待同步</span>
      </header>
      {events.length === 0 ? <EmptyState title="暂无待同步事件" /> : (
        <table className="table">
          <thead>
            <tr>
              <th>事件</th>
              <th>扩展</th>
              <th>状态</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={event.id ?? event.idempotencyKey ?? index}>
                <td>{event.eventType ?? '-'}</td>
                <td>{event.extensionID ?? '-'}</td>
                <td>{event.status ?? event.result ?? '-'}</td>
                <td>{event.errorCode ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TargetsPanel({ rows, onCleanup }: { rows: Array<Record<string, unknown>>; onCleanup: (row: Record<string, unknown>) => void }) {
  return (
    <div className="panel">
      <header className="section-header">
        <h2>生命周期目标</h2>
        <span className="meta">{rows.length} 项</span>
      </header>
      {rows.length === 0 ? <EmptyState title="暂无目标记录" message="已扫描 Skill、MCP、Plugin 托管目录，未发现生命周期目标。" /> : (
        <table className="table">
          <thead>
            <tr>
              <th>扩展</th>
              <th>目标</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <TargetRow key={asText(row.id, String(index))} row={row} onCleanup={onCleanup} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TargetRow({ row, onCleanup }: { row: Record<string, unknown>; onCleanup: (row: Record<string, unknown>) => void }) {
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
  const managed = metadata.managed !== false;
  return (
    <tr>
      <td>{asText(row.extensionId)}</td>
      <td>{asText(row.target ?? row.configPath)}</td>
      <td><StatusBadge tone={riskTone(String(row.status ?? ''))}>{statusLabel(asText(row.status))}</StatusBadge></td>
      <td>{managed ? <Button tone="danger" onClick={() => onCleanup(row)}>清理托管项</Button> : <span className="meta">扫描记录</span>}</td>
    </tr>
  );
}
