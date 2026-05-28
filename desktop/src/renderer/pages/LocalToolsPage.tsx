import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { asText, compactDate, riskTone, statusLabel } from '../lib/formatting';
import type { LocalLifecycleSnapshot } from '../types/desktop';

export function LocalToolsPage({ snapshot }: { snapshot: LocalLifecycleSnapshot }) {
  return (
    <section className="panel" aria-label="本地工具">
      <header className="section-header">
        <h2>本地工具</h2>
        <span className="meta">{snapshot.tools.length} 项</span>
      </header>
      {snapshot.tools.length === 0 ? <EmptyState title="暂无工具记录" message="已扫描本地 adapters 目录，未发现 ToolAdapter 定义。" /> : (
        <table className="table">
          <thead>
            <tr>
              <th>工具</th>
              <th>扩展</th>
              <th>目标</th>
              <th>状态</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.tools.map((row) => (
              <tr key={asText(row.id)}>
                <td>{asText(row.toolName)}</td>
                <td>{asText(row.extensionId)}</td>
                <td>{asText(row.target)}</td>
                <td><StatusBadge tone={riskTone(String(row.status ?? ''))}>{statusLabel(asText(row.status))}</StatusBadge></td>
                <td>{compactDate(asText(row.updatedAt, ''))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
