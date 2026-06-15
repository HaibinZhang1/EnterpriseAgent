import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge } from '../components/StatusBadge';
import { asText, compactDate } from '../lib/formatting';
import {
  AuditStatuses,
  LocalResourceTypes,
  SyncStatuses,
  auditStatusLabel,
  localResourceTypeLabel,
  type AggregatedResourceStatus,
  type LocalEventRecord,
  type LocalResourceRow,
  type LocalResourceSnapshot,
  type LocalResourceType,
  type PermissionCategory
} from '../../shared/local-resources';
import type { LoadState, LocalInventoryScanSummary, LocalTab, UiError } from '../types/desktop';

const NAV_ITEMS: Array<{ id: LocalTab; label: string; resourceTypes?: LocalResourceType[]; includeEvents?: boolean }> = [
  { id: 'overview', label: '概览' },
  { id: 'agents', label: '智能体', resourceTypes: [LocalResourceTypes.AGENT, LocalResourceTypes.AGENT_CONFIG, LocalResourceTypes.RULE, LocalResourceTypes.MEMORY, LocalResourceTypes.SUBAGENT, LocalResourceTypes.IGNORE_FILE] },
  { id: 'extensions', label: '扩展', resourceTypes: [LocalResourceTypes.SKILL, LocalResourceTypes.MCP_SERVER, LocalResourceTypes.PLUGIN, LocalResourceTypes.HOOK, LocalResourceTypes.CLI_COMMAND] },
  { id: 'projects', label: '项目', resourceTypes: [LocalResourceTypes.PROJECT] },
  { id: 'toolkits', label: '工具集', resourceTypes: [LocalResourceTypes.KIT] },
  { id: 'audit-events', label: '审计与事件', resourceTypes: [LocalResourceTypes.AUDIT_FINDING, LocalResourceTypes.LOCAL_EVENT], includeEvents: true }
];

type VisibleItem = {
  id: string;
  name: string;
  typeLabel: string;
  type: LocalResourceType | 'EVENT';
  scopeLabel: string;
  permissionLabel: string;
  permissionCategories: PermissionCategory[];
  auditLabel: string;
  auditStatus: string;
  status: AggregatedResourceStatus;
  path?: string;
  version?: string;
  hash?: string;
  updatedAt?: string;
  source?: string;
  row?: LocalResourceRow;
  event?: LocalEventRecord;
};

export function LocalPage({
  snapshot,
  activeTab,
  offline,
  localScanState,
  localScanSummary,
  localScanError,
  onChangeTab,
  onRefreshLocal
}: {
  snapshot: LocalResourceSnapshot;
  activeTab: LocalTab;
  offline: boolean;
  localScanState?: LoadState;
  localScanSummary?: LocalInventoryScanSummary;
  localScanError?: UiError;
  onChangeTab: (tab: LocalTab) => void;
  onRefreshLocal?: () => void;
}) {
  const [typeFilter, setTypeFilter] = useState('全部');
  const [statusFilter, setStatusFilter] = useState('全部');
  const [auditFilter, setAuditFilter] = useState('全部');
  const [permissionFilter, setPermissionFilter] = useState('全部');
  const [scopeFilter, setScopeFilter] = useState('全部');
  const [selected, setSelected] = useState<VisibleItem | undefined>();

  const activeNav = NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0];
  const allItems = useMemo(() => createVisibleItems(snapshot, activeNav), [snapshot, activeNav]);
  const filteredItems = useMemo(() => allItems.filter((item) => (
    (typeFilter === '全部' || item.typeLabel === typeFilter)
    && (statusFilter === '全部' || item.status.label === statusFilter)
    && (auditFilter === '全部' || item.auditLabel === auditFilter)
    && (permissionFilter === '全部' || item.permissionLabel === permissionFilter || item.permissionCategories.includes(permissionFilter as PermissionCategory))
    && (scopeFilter === '全部' || item.scopeLabel === scopeFilter)
  )), [allItems, auditFilter, permissionFilter, scopeFilter, statusFilter, typeFilter]);

  const counts = useMemo(() => Object.fromEntries(NAV_ITEMS.map((item) => [item.id, createVisibleItems(snapshot, item).length])), [snapshot]);
  const typeOptions = uniqueOptions(allItems.map((item) => item.typeLabel));
  const statusOptions = uniqueOptions(allItems.map((item) => item.status.label));
  const auditOptions = uniqueOptions(allItems.map((item) => item.auditLabel));
  const permissionOptions = uniqueOptions(allItems.flatMap((item) => item.permissionCategories.length > 0 ? item.permissionCategories : [item.permissionLabel]));
  const scopeOptions = uniqueOptions(allItems.map((item) => item.scopeLabel));

  const switchTab = (tab: LocalTab) => {
    onChangeTab(tab);
    setTypeFilter('全部');
    setStatusFilter('全部');
    setAuditFilter('全部');
    setPermissionFilter('全部');
    setScopeFilter('全部');
    setSelected(undefined);
  };

  return (
    <div className="saas-layout" style={{ height: '100%', overflow: 'hidden' }} aria-label="本地资源管理">
      <aside className="saas-sidebar" style={{ height: '100%', overflowY: 'auto' }} aria-label="本地导航">
        <div className="saas-sidebar-header">本地</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`saas-sidebar-item ${activeTab === item.id ? 'active' : ''}`}
            aria-label={`打开本地页面：${item.label}`}
            aria-pressed={activeTab === item.id}
            data-testid={`local-nav-${item.id}`}
            onClick={() => switchTab(item.id)}
          >
            <span className="saas-sidebar-item-label">{item.label}</span>
            <span className="saas-sidebar-item-badge">{counts[item.id] ?? 0}</span>
          </button>
        ))}
      </aside>

      <div className="saas-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px 24px' }}>
        {localScanError ? (
          <div style={{ marginBottom: '16px', flexShrink: 0 }}>
            <ErrorState error={localScanError} title="本地扫描失败" />
          </div>
        ) : null}

        <section className="panel" style={{ margin: '0 0 16px 0', padding: '16px', flexShrink: 0 }} aria-label={`${activeNav.label}概览`}>
          <header className="section-header">
            <div>
              <h2>{activeNav.label}</h2>
              <span className="meta" data-testid="local-scan-summary">{formatScanSummary(localScanState, localScanSummary, snapshot)}</span>
            </div>
            <div className="card-action-row">
              <Button tone="primary" onClick={onRefreshLocal} data-testid="local-rescan">重新扫描</Button>
              <Button disabled title="阶段一仅建模，审计执行在后续阶段启用" data-testid="local-disabled-audit">运行审计</Button>
              <Button disabled title="检查更新需要服务端授权和阶段二/三能力">检查更新</Button>
              <Button disabled title="导入会写入本地资源，阶段一禁用">导入</Button>
            </div>
          </header>
          <p className="muted">
            {offline ? '当前离线：新增服务端动作已暂停。' : '在线状态可用；阶段一仅展示真实扫描与本地记录。'}
            {' '}待同步事件 {snapshot.summary.pendingSyncEvents}，失败状态 {snapshot.summary.failureCount}。
          </p>
        </section>

        <section className="filter-bar" style={{ marginBottom: '16px', flexShrink: 0 }} aria-label="本地资源筛选">
          <FilterSelect label="作用域" value={scopeFilter} options={scopeOptions} onChange={setScopeFilter} testId="local-scope-filter" />
          <FilterSelect label="类型" value={typeFilter} options={typeOptions} onChange={setTypeFilter} testId="local-type-filter" />
          <FilterSelect label="状态" value={statusFilter} options={statusOptions} onChange={setStatusFilter} testId="local-status-filter" />
          <FilterSelect label="审计" value={auditFilter} options={auditOptions} onChange={setAuditFilter} testId="local-audit-filter" />
          <FilterSelect label="权限" value={permissionFilter} options={permissionOptions} onChange={setPermissionFilter} testId="local-permission-filter" />
        </section>

        <section className="panel" style={{ flex: 1, overflowY: 'auto', padding: '12px', margin: 0 }} aria-label={`${activeNav.label}列表`}>
          {filteredItems.length === 0 ? (
            <EmptyState title={`暂无${activeNav.label}资源`} message={emptyMessage(activeTab, localScanState, snapshot)} />
          ) : (
            <table className="table" data-testid="local-resource-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
                  <th>智能体/项目</th>
                  <th>权限</th>
                  <th>审计</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <div className="muted">{resourceSubtext(item)}</div>
                    </td>
                    <td>{item.typeLabel}</td>
                    <td>{item.scopeLabel}</td>
                    <td>{item.permissionLabel}</td>
                    <td>{item.auditLabel}</td>
                    <td><StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge></td>
                    <td>
                      <Button tone="ghost" onClick={() => setSelected(item)} data-testid={`local-detail-${safeId(item.id)}`}>详情</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {selected ? <LocalResourceDrawer item={selected} snapshot={snapshot} onClose={() => setSelected(undefined)} /> : null}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: string[]; onChange: (value: string) => void; testId: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span className="filter-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} disabled={options.length <= 1}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function LocalResourceDrawer({ item, snapshot, onClose }: { item: VisibleItem; snapshot: LocalResourceSnapshot; onClose: () => void }) {
  const row = item.row;
  const resource = row?.resource;
  const binding = row?.binding;
  const relatedRows = resource ? snapshot.rows.filter((candidate) => candidate.resource.id === resource.id) : row ? [row] : [];
  return (
    <Drawer title={item.name} onClose={onClose}>
      <section className="panel">
        <h3>基本信息</h3>
        <DetailLine label="类型" value={item.typeLabel} />
        <DetailLine label="来源" value={item.source} />
        <DetailLine label="版本" value={item.version} />
        <DetailLine label="路径" value={item.path} />
        <DetailLine label="Hash" value={item.hash} />
      </section>
      <section className="panel">
        <h3>绑定分布</h3>
        <DetailLine label="绑定数量" value={relatedRows.length} />
        <DetailLine label="作用域" value={item.scopeLabel} />
        <DetailLine label="智能体" value={binding?.agentId} />
        <DetailLine label="项目" value={binding?.projectId} />
        <DetailLine label="工具集" value={binding?.kitId} />
        {relatedRows.length > 0 ? (
          <table className="table compact-table">
            <tbody>
              {relatedRows.slice(0, 6).map((candidate) => (
                <tr key={candidate.binding?.id ?? candidate.resource.id}>
                  <td>{candidate.scopeLabel}</td>
                  <td>{candidate.binding?.agentId ?? candidate.binding?.projectId ?? candidate.binding?.kitId ?? '未绑定'}</td>
                  <td>{candidate.status.label}</td>
                  <td>{candidate.binding?.targetPath ?? candidate.resource.sourcePath ?? '未知'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
      <section className="panel">
        <h3>权限与审计</h3>
        <DetailLine label="权限" value={item.permissionLabel} />
        <DetailLine label="审计" value={item.auditLabel} />
        <DetailLine label="状态" value={item.status.label} />
      </section>
      <section className="panel">
        <h3>最近事件</h3>
        {(item.event ? [item.event] : row?.events ?? []).length === 0 ? (
          <p className="muted">没有关联本地事件。</p>
        ) : (
          <table className="table compact-table">
            <tbody>
              {(item.event ? [item.event] : row?.events ?? []).slice(0, 5).map((event) => (
                <tr key={event.eventId}>
                  <td>{event.eventType}</td>
                  <td>{event.message}</td>
                  <td>{compactDate(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h3>操作边界</h3>
        <p className="muted">阶段一只提供真实数据驱动的列表、空状态和详情入口；写入、执行 Hook、执行 CLI、运行 shell-command 均未开放。</p>
        <div className="card-action-row">
          <Button disabled title="阶段一禁用未完成操作">启用</Button>
          <Button disabled title="阶段一禁用未完成操作">停用</Button>
          <Button disabled title="阶段一不执行 Hook/CLI/命令">执行</Button>
        </div>
      </section>
      {resource?.metadata ? <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(resource.metadata, null, 2)}</pre> : null}
    </Drawer>
  );
}

function DetailLine({ label, value }: { label: string; value?: unknown }) {
  return (
    <p>
      <strong>{label}：</strong>{asText(value, '未知')}
    </p>
  );
}

function createVisibleItems(snapshot: LocalResourceSnapshot, nav: typeof NAV_ITEMS[number]): VisibleItem[] {
  const resourceItems = (snapshot.rows ?? [])
    .filter((row) => !nav.resourceTypes || nav.resourceTypes.includes(row.resource.type))
    .map(rowToItem);
  const eventItems = nav.includeEvents
    ? (snapshot.events ?? []).map(eventToItem)
    : [];
  return [...resourceItems, ...eventItems];
}

function rowToItem(row: LocalResourceRow): VisibleItem {
  const resource = row.resource;
  const binding = row.binding;
  const file = row.files[0];
  return {
    id: `${resource.id}:${binding?.id ?? 'resource'}`,
    name: resource.displayName || resource.name,
    typeLabel: localResourceTypeLabel(resource.type),
    type: resource.type,
    scopeLabel: row.scopeLabel,
    permissionLabel: resource.permissionSummary.label || '未声明',
    permissionCategories: resource.permissionSummary.categories,
    auditLabel: auditStatusLabel(resource.auditSummary.status),
    auditStatus: resource.auditSummary.status,
    status: row.status,
    path: binding?.targetPath ?? resource.sourcePath ?? file?.path,
    version: resource.version,
    hash: resource.sha256 ?? resource.packageHash ?? file?.currentHash,
    updatedAt: binding?.updatedAt ?? resource.lastScannedAt ?? resource.createdAt,
    source: resource.sourceType,
    row
  };
}

function eventToItem(event: LocalEventRecord): VisibleItem {
  const status = event.syncStatus === SyncStatuses.SERVER_REJECTED || event.status === 'failure'
    ? { key: 'event_failure', label: '失败', tone: 'danger' as const, source: 'event' }
    : event.syncStatus === SyncStatuses.PENDING_SYNC
      ? { key: 'event_pending', label: '待同步', tone: 'info' as const, source: 'event' }
      : { key: 'event_info', label: event.status === 'success' ? '成功' : '事件', tone: 'info' as const, source: 'event' };
  return {
    id: event.eventId,
    name: event.message,
    typeLabel: localResourceTypeLabel(LocalResourceTypes.LOCAL_EVENT),
    type: 'EVENT',
    scopeLabel: [event.agentId, event.projectId, event.kitId].filter(Boolean).join(' / ') || '本地事件',
    permissionLabel: '不适用',
    permissionCategories: [],
    auditLabel: auditStatusLabel(AuditStatuses.NOT_AUDITED),
    auditStatus: AuditStatuses.NOT_AUDITED,
    status,
    updatedAt: event.createdAt,
    source: event.eventType,
    event
  };
}

function uniqueOptions(values: string[]): string[] {
  return ['全部', ...Array.from(new Set(values.filter(Boolean)))];
}

function resourceSubtext(item: VisibleItem): string {
  const parts = [
    item.type === 'EVENT' && item.source ? item.source : undefined,
    item.path,
    item.version ? `版本 ${item.version}` : undefined,
    item.hash ? `Hash ${item.hash.slice(0, 12)}` : undefined,
    item.updatedAt ? `更新 ${compactDate(item.updatedAt)}` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' | ') : '真实记录，无额外路径或版本字段';
}

function formatScanSummary(state: LoadState | undefined, summary: LocalInventoryScanSummary | undefined, snapshot: LocalResourceSnapshot): string {
  if (state === 'loading') return '正在扫描本地资源';
  const discovered = summary?.discovered;
  if (discovered) {
    return `资源 ${snapshot.summary.resourceCount}，绑定 ${snapshot.summary.bindingCount}，扫描发现 ${discovered.total ?? 0}，失败 ${discovered.failures ?? 0}`;
  }
  return `资源 ${snapshot.summary.resourceCount}，绑定 ${snapshot.summary.bindingCount}`;
}

function emptyMessage(tab: LocalTab, state: LoadState | undefined, snapshot: LocalResourceSnapshot): string {
  if (state === 'loading') return '正在读取本地数据库和扫描目录。';
  if (snapshot.summary.failureCount > 0) return '当前筛选没有匹配项，扫描失败项可在审计与事件中查看。';
  if (tab === 'overview') return '已完成本地扫描，未发现可展示资源。';
  return '没有符合当前页面和筛选条件的真实本地资源。';
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
