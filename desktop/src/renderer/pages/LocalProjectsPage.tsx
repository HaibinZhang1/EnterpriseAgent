import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { asText, compactDate, riskTone, statusLabel } from '../lib/formatting';
import type { LocalLifecycleSnapshot } from '../types/desktop';

export function LocalProjectsPage({ snapshot }: { snapshot: LocalLifecycleSnapshot }) {
  return (
    <section className="panel" aria-label="本地项目">
      <header className="section-header">
        <h2>本地项目</h2>
        <span className="meta">{snapshot.projects.length} 项</span>
      </header>
      {snapshot.projects.length === 0 ? <EmptyState title="暂无项目记录" message="已扫描本地 projects 目录，未发现项目绑定记录。" /> : (
        <table className="table">
          <thead>
            <tr>
              <th>项目</th>
              <th>扩展</th>
              <th>状态</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.projects.map((row) => (
              <tr key={asText(row.projectId)}>
                <td>{asText(row.name)}</td>
                <td>{asText(row.extensionId)}</td>
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
