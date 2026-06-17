import { useState, useMemo } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { ErrorState } from '../components/ErrorState';
import { asText, compactDate, riskTone, statusLabel, extensionKindLabel } from '../lib/formatting';
import { formatLocalDetailDescription } from '../lib/localDetail';
import type { LocalLifecycleSnapshot, ExtensionSummary, LoadState, LocalInventoryScanSummary, UiError } from '../types/desktop';
import { LocalProjectsPage } from './LocalProjectsPage';
import { LocalToolsPage } from './LocalToolsPage';

type LocalPageTab = 'skill' | 'mcp' | 'plugin' | 'project';

export function LocalExtensionsPage({
  snapshot,
  offline,
  onCleanup,
  onOpenDetail,
  localScanState,
  localScanSummary,
  localScanError,
  onRefreshLocal
}: {
  snapshot: LocalLifecycleSnapshot;
  offline: boolean;
  onCleanup: (row: Record<string, unknown>) => void;
  onOpenDetail?: (item: ExtensionSummary) => void;
  localScanState?: LoadState;
  localScanSummary?: LocalInventoryScanSummary;
  localScanError?: UiError;
  onRefreshLocal?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<LocalPageTab>('skill');
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Status Filter options
  const statusOptions = ['全部', '已安装', '已启用', '已接入', '有更新', '异常', '授权收缩', '安全风险'];

  // Safe helper to extract metadata object from a row
  const getMetadata = (row: Record<string, unknown> | undefined): Record<string, unknown> => {
    if (!row || !row.metadata || typeof row.metadata !== 'object') return {};
    return row.metadata as Record<string, unknown>;
  };

  // Aggregate extensions, targets, mcps, and plugins by canonical local instance.
  const allLocalEntries = useMemo(() => {
    const extIds = new Set<string>();

    snapshot.extensions.forEach(e => { if (e.extensionId) extIds.add(String(e.extensionId)); });
    snapshot.targets.forEach(t => { if (t.extensionId) extIds.add(String(t.extensionId)); });
    snapshot.mcpInstallations.forEach(m => { if (m.extensionId) extIds.add(String(m.extensionId)); });
    snapshot.pluginInstallations.forEach(p => { if (p.extensionId) extIds.add(String(p.extensionId)); });

    return groupLocalExtensionIds(Array.from(extIds), snapshot).map(extensionIds => {
      const extensionId = preferredLocalExtensionId(extensionIds, snapshot);
      const baseExt = snapshot.extensions.find(e => String(e.extensionId) === extensionId);

      const relatedTargets = dedupeLocalRecords(
        extensionIds.flatMap(id => snapshot.targets.filter(t => String(t.extensionId) === id)),
        localTargetKey
      );
      const relatedMcps = dedupeLocalRecords(
        extensionIds.flatMap(id => snapshot.mcpInstallations.filter(m => String(m.extensionId) === id)),
        localTargetKey
      );
      const relatedPlugins = dedupeLocalRecords(
        extensionIds.flatMap(id => snapshot.pluginInstallations.filter(p => String(p.extensionId) === id)),
        localTargetKey
      );

      // Determine kind: 'skill' | 'mcp' | 'plugin'
      let kind: 'skill' | 'mcp' | 'plugin' = 'skill';
      if (relatedMcps.length > 0 || extensionId.startsWith('mcp:')) {
        kind = 'mcp';
      } else if (relatedPlugins.length > 0 || extensionId.startsWith('plugin:')) {
        kind = 'plugin';
      } else if (relatedTargets.length > 0) {
        const targetKind = getMetadata(relatedTargets[0]).kind;
        if (targetKind === 'mcp' || targetKind === 'plugin' || targetKind === 'skill') {
          kind = targetKind as 'skill' | 'mcp' | 'plugin';
        }
      }

      const relatedVersions = extensionIds.flatMap(id => snapshot.versions.filter(v => String(v.extensionId) === id));
      const localVersion = asText(
        relatedVersions[0]?.version
        || baseExt?.version
        || getMetadata(relatedTargets[0]).version
        || getMetadata(relatedMcps[0]).version
        || getMetadata(relatedPlugins[0]).version
        || '-'
      );

      const latestVersion = asText(
        getMetadata(baseExt).latestVersion
        || getMetadata(relatedTargets[0]).latestVersion
        || getMetadata(relatedMcps[0]).latestVersion
        || getMetadata(relatedPlugins[0]).latestVersion
        || localVersion
      );

      const status = String(baseExt?.status || relatedTargets[0]?.status || relatedMcps[0]?.status || relatedPlugins[0]?.status || 'scanned');

      const targetCount = relatedTargets.length + relatedMcps.length + relatedPlugins.length;

      const dates = [
        baseExt?.updatedAt,
        ...relatedTargets.map(t => t.updatedAt),
        ...relatedMcps.map(m => m.updatedAt),
        ...relatedPlugins.map(p => p.updatedAt)
      ].map(d => d ? new Date(String(d)).getTime() : 0).filter(t => !isNaN(t) && t > 0);
      const latestUpdate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : String(baseExt?.updatedAt || '');

      let errorSummary = '';
      if (status === 'failed' || status === 'security_blocked' || status === 'scope_reduced' || status === 'partial_success') {
        const msgs = [
          getMetadata(baseExt).message,
          getMetadata(baseExt).error,
          ...relatedTargets.map(t => getMetadata(t).message || getMetadata(t).error),
          ...relatedMcps.map(m => getMetadata(m).message || getMetadata(m).error || getMetadata(m).serverStateHint),
          ...relatedPlugins.map(p => getMetadata(p).message || getMetadata(p).error)
        ].filter(Boolean);
        if (msgs.length > 0) {
          errorSummary = String(msgs[0]);
        } else if (status === 'security_blocked') {
          errorSummary = '安全下架或存在已知风险';
        } else if (status === 'scope_reduced') {
          errorSummary = '授权范围已收缩，部分权限已被限制';
        }
      }

      const name = asText(baseExt?.name || relatedTargets[0]?.name || relatedMcps[0]?.name || relatedPlugins[0]?.name || extensionId);
      const summary = asText(baseExt?.summary || relatedTargets[0]?.summary || relatedMcps[0]?.summary || relatedPlugins[0]?.summary || '本地导入的扩展实例');

      return {
        extensionId,
        kind,
        name,
        summary,
        localVersion,
        latestVersion,
        status,
        targetCount,
        latestUpdate,
        errorSummary,
        baseExt,
        relatedTargets,
        relatedMcps,
        relatedPlugins
      };
    });
  }, [snapshot]);

  // Step 1: Filter by SaaS left Sidebar active tab
  const tabEntries = useMemo(() => {
    return allLocalEntries.filter(entry => entry.kind === activeTab);
  }, [allLocalEntries, activeTab]);

  // Step 2: Apply status filter
  const filteredEntries = useMemo(() => {
    return tabEntries.filter(entry => {
      if (statusFilter !== '全部') {
        const s = entry.status.toLowerCase();
        if (statusFilter === '已安装') {
          return s === 'installed' || s === 'scanned';
        }
        if (statusFilter === '已启用') {
          return s === 'enabled';
        }
        if (statusFilter === '已接入') {
          return s === 'connected';
        }
        if (statusFilter === '有更新') {
          return (entry.localVersion !== entry.latestVersion && entry.latestVersion !== '-');
        }
        if (statusFilter === '异常') {
          return s === 'failed' || s === 'partial_success' || entry.errorSummary.length > 0;
        }
        if (statusFilter === '授权收缩') {
          return s === 'scope_reduced';
        }
        if (statusFilter === '安全风险') {
          return s === 'security_blocked' || s === 'security_risk';
        }
      }
      return true;
    });
  }, [tabEntries, statusFilter]);

  const toggleRow = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenDetail = (entry: typeof allLocalEntries[0]) => {
    if (onOpenDetail) {
      onOpenDetail({
        id: entry.extensionId,
        type: entry.kind,
        name: entry.name,
        summary: entry.summary,
        description: formatLocalDetailDescription(entry),
        version: entry.localVersion !== '-' ? String(entry.localVersion) : undefined,
        tags: [],
        status: entry.status
      });
    }
  };

  const navItems: Array<{ id: LocalPageTab; label: string; icon: string; count: number }> = [
    { id: 'skill', label: 'Skills 技能', icon: '⚡', count: allLocalEntries.filter(e => e.kind === 'skill').length },
    { id: 'mcp', label: 'MCP 服务', icon: '🔌', count: allLocalEntries.filter(e => e.kind === 'mcp').length },
    { id: 'plugin', label: '插件 Plugins', icon: '⚙️', count: allLocalEntries.filter(e => e.kind === 'plugin').length },
    { id: 'project', label: '本地项目', icon: '📁', count: snapshot.projects?.length ?? 0 }
  ];

  const activeLabel = activeTab === 'skill' ? 'Skill 技能' : activeTab === 'mcp' ? 'MCP 服务' : activeTab === 'plugin' ? 'Plugin 原生插件' : '关联项目';
  const isExtensionTab = activeTab === 'skill' || activeTab === 'mcp' || activeTab === 'plugin';
  const scanSummaryText = formatScanSummary(localScanSummary);

  return (
    <div className="saas-layout" style={{ height: '100%', overflow: 'hidden' }} aria-label="本地已安装扩展">
      {/* Left Glass Sidebar */}
      <aside className="saas-sidebar" style={{ height: '100%', overflowY: 'auto' }} aria-label="本地分类导航">
        <div className="saas-sidebar-header">本地仓库管理</div>
        {navItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={`saas-sidebar-item ${activeTab === item.id ? 'active' : ''}`}
            aria-label={`打开本地分类：${item.label}`}
            aria-pressed={activeTab === item.id}
            data-testid={`local-nav-${item.id}`}
            onClick={() => {
              setActiveTab(item.id);
              setStatusFilter('全部');
            }}
          >
            <span className="saas-sidebar-item-label">
              <span style={{ fontSize: '13px', marginRight: '8px', opacity: 0.85 }}>{item.icon}</span>
              {item.label}
            </span>
            <span className="saas-sidebar-item-badge">{item.count}</span>
          </button>
        ))}
      </aside>

      {/* Right Main Content */}
      <div className="saas-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px 24px' }}>

        {localScanError && isExtensionTab && (
          <div style={{ marginBottom: '16px', flexShrink: 0 }}>
            <ErrorState error={localScanError} title="本地扫描失败" />
          </div>
        )}

        {/* Dynamic Inner views based on selected tab */}
        {activeTab === 'project' ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <LocalProjectsPage snapshot={snapshot} />
          </div>
        ) : (
          /* Main Extensions (Skills, MCPs, Plugins) view */
          <>
            {/* Status Filter Panel with Integrated Rescan Button */}
            <div
              className="filter-bar"
              style={{
                margin: '0 0 16px 0',
                padding: '8px 14px',
                borderRadius: '12px',
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px'
              }}
            >
              <div className="filter-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="filter-label" style={{ flexShrink: 0 }}>状态筛选:</span>
                <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {statusOptions.map(opt => (
                    <button
                      key={opt}
                      type="button"
                      className={`chip ${statusFilter === opt ? 'active' : ''}`}
                      aria-label={`筛选本地${activeLabel}：${opt}`}
                      aria-pressed={statusFilter === opt}
                      data-testid={`local-filter-${opt}`}
                      onClick={() => setStatusFilter(opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Merge Rescan Button here */}
              {onRefreshLocal && isExtensionTab && (
                <Button
                  onClick={onRefreshLocal}
                  disabled={localScanState === 'loading'}
                  aria-label={`重新扫描本地${activeLabel}`}
                  data-testid="local-rescan"
                  style={{
                    minHeight: '28px',
                    padding: '0 12px',
                    fontSize: '12px',
                    flexShrink: 0
                  }}
                >
                  {localScanState === 'loading' ? '正在扫描' : '重新扫描'}
                </Button>
              )}
            </div>

            {(localScanState === 'loading' || scanSummaryText) ? (
              <div className="local-scan-summary" aria-live="polite" data-testid="local-scan-summary">
                <span className="filter-label">扫描状态</span>
                <span className="meta">{localScanState === 'loading' ? '正在扫描本地目录' : scanSummaryText}</span>
              </div>
            ) : null}

            {/* List Cards Container with viewport isolated independent scroll */}
            <div className="panel" style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', margin: 0 }}>
              {filteredEntries.length === 0 ? (
                <EmptyState
                  title={`无匹配的本地 ${activeLabel}`}
                  message={tabEntries.length === 0 ? `未发现任何本地已安装或扫描缓存的 ${activeLabel} 记录。` : "没有满足当前状态筛选条件的本地扩展项。"}
                />
              ) : (
                /* Compact native cards list */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {filteredEntries.map(entry => {
                    const isExpanded = !!expandedIds[entry.extensionId];
                    const hasUpdate = entry.localVersion !== entry.latestVersion && entry.latestVersion !== '-';

                    // Color mapping for type tags
                    let kindColorClass = 'badge-skill';
                    if (entry.kind === 'mcp') kindColorClass = 'badge-mcp';
                    if (entry.kind === 'plugin') kindColorClass = 'badge-plugin';

                    return (
                      <div
                        key={entry.extensionId}
                        className="list-card-row"
                        data-testid={`local-${entry.kind}-row-${entry.extensionId}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: '12px',
                          border: '1px solid var(--glass-border-soft)',
                          background: 'var(--glass-secondary)',
                          backdropFilter: 'blur(10px)',
                          transition: 'all 200ms ease',
                          padding: '12px 16px'
                        }}
                      >
                        {/* Upper Card Main Info Row */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                          {/* Left Details Block */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                            {/* Small Elegant Icon Badge */}
                            <span className={`badge ${kindColorClass}`} style={{ flexShrink: 0, padding: '4px 8px', fontSize: '11px', borderRadius: '6px' }}>
                              {extensionKindLabel(entry.kind)}
                            </span>
                            {/* Text Summary */}
                            <div style={{ minWidth: 0 }}>
                              <strong style={{ fontSize: '14px', color: 'var(--text-primary)', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {entry.name}
                              </strong>
                              <span className="muted" style={{ fontSize: '11px', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginTop: '2px' }}>
                                {entry.errorSummary ? (
                                  <span style={{ color: 'var(--color-danger)' }}>⚠ {entry.errorSummary}</span>
                                ) : (
                                  entry.summary
                                )}
                              </span>
                            </div>
                          </div>

                          {/* Center Status Indicators */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                            {/* Version Info */}
                            <div style={{ fontSize: '12px', textAlign: 'right' }}>
                              {hasUpdate ? (
                                <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>
                                  <code>{entry.localVersion}</code> ↗ <code>{entry.latestVersion}</code>
                                </span>
                              ) : (
                                <code style={{ opacity: 0.8 }}>v{entry.localVersion}</code>
                              )}
                            </div>
                            {/* Status badge */}
                            <StatusBadge tone={riskTone(entry.status)}>
                              {statusLabel(entry.status)}
                            </StatusBadge>
                            {/* Chevron Instance indicator */}
                            {entry.targetCount > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleRow(entry.extensionId)}
                                aria-expanded={isExpanded}
                                aria-label={`${isExpanded ? '收起' : '展开'} ${entry.name} 的 ${entry.targetCount} 个本地实例`}
                                data-testid={`local-expand-${entry.extensionId}`}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--text-secondary)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '4px',
                                  fontSize: '12px',
                                  textDecoration: 'underline'
                                }}
                                title={isExpanded ? '收起实例' : '展开实例'}
                              >
                                {entry.targetCount} 项 <ChevronIcon expanded={isExpanded} />
                              </button>
                            )}
                          </div>

                          {/* Right Interactive Action Group */}
                          <div className="action-group-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px', flexShrink: 0, overflow: 'visible' }}>

                            <Button
                              onClick={() => handleOpenDetail(entry)}
                              aria-label={`查看 ${entry.name} 详情`}
                              data-testid={`local-detail-${entry.extensionId}`}
                              style={{ padding: '0 14px', minHeight: '32px', fontSize: '12px' }}
                            >
                              {hasUpdate ? '查看更新' : '查看详情'}
                            </Button>

                            <div className="secondary-actions" style={{ display: 'flex', gap: '6px' }}>
                              {entry.baseExt ? (
                                <Button
                                  onClick={() => onCleanup(entry.baseExt!)}
                                  tone="danger"
                                  aria-label={`清理 ${entry.name} 本地记录`}
                                  data-testid={`local-cleanup-${entry.extensionId}`}
                                  style={{ padding: '0 12px', minHeight: '32px', fontSize: '12px' }}
                                >
                                  本地清理
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Lower Sub-list of targets/installations inside expanded rows */}
                        {isExpanded && entry.targetCount > 0 && (
                          <div
                            className="expanded-targets-box"
                            style={{
                              background: 'rgba(255, 255, 255, 0.01)',
                              borderTop: '1px solid var(--glass-border-soft)',
                              padding: '12px 0 4px 0',
                              marginTop: '12px',
                              borderRadius: '0 0 8px 8px'
                            }}
                          >
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                              {extensionKindLabel(entry.kind)} 本地托管实例与生命周期目标
                            </h4>
                            <table className="table compact-table" style={{ width: '100%', fontSize: '11px', margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>实例类型</th>
                                  <th>目标路径 / 托管配置文件</th>
                                  <th style={{ width: '120px' }}>运行状态</th>
                                  <th style={{ width: '120px', textAlign: 'right' }}>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.relatedTargets.map((row, idx) => {
                                  const metadata = getMetadata(row);
                                  const managed = metadata.managed !== false;
                                  return (
                                    <tr key={`target-${row.id || idx}`}>
                                      <td>Skill 激活目标</td>
                                      <td><code>{asText(row.target)}</code></td>
                                      <td>
                                        <StatusBadge tone={riskTone(String(row.status ?? ''))}>
                                          {statusLabel(asText(row.status))}
                                        </StatusBadge>
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        {managed ? (
                                          <Button
                                            tone="danger"
                                            onClick={() => onCleanup(row)}
                                            aria-label={`停用 ${entry.name} 托管项 ${idx + 1}`}
                                            data-testid={`local-cleanup-target-${entry.extensionId}-${idx}`}
                                            style={{ padding: '0 8px', minHeight: '26px', fontSize: '11px' }}
                                          >
                                            停用托管项
                                          </Button>
                                        ) : (
                                          <span className="meta">自动扫描记录</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {entry.relatedMcps.map((row, idx) => {
                                  return (
                                    <tr key={`mcp-${row.id || idx}`}>
                                      <td>MCP 接入配置</td>
                                      <td><code>{asText(row.configPath ?? row.target)}</code></td>
                                      <td>
                                        <StatusBadge tone={riskTone(String(row.status ?? ''))}>
                                          {statusLabel(asText(row.status))}
                                        </StatusBadge>
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        <Button
                                          tone="danger"
                                          onClick={() => onCleanup(row)}
                                          aria-label={`清理 ${entry.name} MCP 配置 ${idx + 1}`}
                                          data-testid={`local-cleanup-mcp-${entry.extensionId}-${idx}`}
                                          style={{ padding: '0 8px', minHeight: '26px', fontSize: '11px' }}
                                        >
                                          清理配置
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {entry.relatedPlugins.map((row, idx) => {
                                  return (
                                    <tr key={`plugin-${row.id || idx}`}>
                                      <td>Plugin 激活实例</td>
                                      <td><code>{asText(row.target)}</code></td>
                                      <td>
                                        <StatusBadge tone={riskTone(String(row.status ?? ''))}>
                                          {statusLabel(asText(row.status))}
                                        </StatusBadge>
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        <Button
                                          tone="danger"
                                          onClick={() => onCleanup(row)}
                                          aria-label={`清理 ${entry.name} Plugin 实例 ${idx + 1}`}
                                          data-testid={`local-cleanup-plugin-${entry.extensionId}-${idx}`}
                                          style={{ padding: '0 8px', minHeight: '26px', fontSize: '11px' }}
                                        >
                                          清理插件
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatScanSummary(summary?: LocalInventoryScanSummary): string | undefined {
  const discovered = summary?.discovered;
  if (!discovered) return undefined;
  const parts = [
    ['Skill', discovered.skills],
    ['MCP', discovered.mcpConfigs],
    ['Plugin', discovered.plugins],
    ['Tool', discovered.tools],
    ['Project', discovered.projects]
  ]
    .filter((item): item is [string, number] => typeof item[1] === 'number' && item[1] > 0)
    .map(([label, count]) => `${label} ${count}`);
  if (parts.length === 0) return '未发现本地记录';
  return `${parts.join(' / ')}${summary.scannedAt ? ` · ${compactDate(summary.scannedAt)}` : ''}`;
}

function groupLocalExtensionIds(extensionIds: string[], snapshot: LocalLifecycleSnapshot): string[][] {
  const groups = new Map<string, string[]>();
  for (const extensionId of extensionIds) {
    const key = localExtensionCanonicalKey(extensionId, snapshot);
    groups.set(key, [...(groups.get(key) ?? []), extensionId]);
  }
  return [...groups.values()];
}

function localExtensionCanonicalKey(extensionId: string, snapshot: LocalLifecycleSnapshot): string {
  const targets = snapshot.targets.filter((row) => String(row.extensionId) === extensionId);
  const baseExt = snapshot.extensions.find((row) => String(row.extensionId) === extensionId);
  const skillKey = localSkillManifestKey([baseExt, ...targets]);
  return skillKey ?? extensionId;
}

function preferredLocalExtensionId(extensionIds: string[], snapshot: LocalLifecycleSnapshot): string {
  return [...extensionIds].sort((left, right) => localExtensionRank(right, snapshot) - localExtensionRank(left, snapshot))[0] ?? extensionIds[0];
}

function localExtensionRank(extensionId: string, snapshot: LocalLifecycleSnapshot): number {
  const targets = snapshot.targets.filter((row) => String(row.extensionId) === extensionId);
  if (targets.some((row) => isSkillManifestPath(asText(row.target, '')))) return 3;
  if (targets.some((row) => Boolean(asText(recordMetadata(row).skillFile, '')))) return 2;
  if (!extensionId.startsWith('codex.skill.')) return 1;
  return 0;
}

function dedupeLocalRecords<T extends Record<string, unknown>>(records: T[], keyFor: (record: T) => string): T[] {
  const seen = new Set<string>();
  return records.flatMap((record) => {
    const key = keyFor(record);
    if (seen.has(key)) return [];
    seen.add(key);
    return [record];
  });
}

function localTargetKey(record: Record<string, unknown>): string {
  return localSkillManifestKey([record])
    ?? asText(record.target ?? record.configPath ?? record.id, JSON.stringify(record));
}

function localSkillManifestKey(records: Array<Record<string, unknown> | undefined>): string | undefined {
  for (const record of records) {
    if (!record) continue;
    const metadata = recordMetadata(record);
    const target = asText(record.target ?? record.configPath, '');
    const skillFile = asText(metadata.skillFile, '');
    if (skillFile) return `skill:${normalizeLocalPath(skillFile)}`;
    if (isSkillManifestPath(target)) return `skill:${normalizeLocalPath(target)}`;
    const skillDirectory = asText(metadata.skillDirectory, '');
    if (skillDirectory) return `skill:${normalizeLocalPath(`${skillDirectory}/SKILL.md`)}`;
    if (isKnownToolSkill(metadata) && target) return `skill:${normalizeLocalPath(`${target}/SKILL.md`)}`;
  }
  return undefined;
}

function recordMetadata(record: Record<string, unknown> | undefined): Record<string, unknown> {
  return record?.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : {};
}

function isKnownToolSkill(metadata: Record<string, unknown>): boolean {
  return metadata.source === 'known_tool_scan' && (metadata.adapterId === 'codex' || metadata.hasSkillMd === true);
}

function isSkillManifestPath(value: string): boolean {
  return /(^|[\\/])SKILL\.md$/i.test(value);
}

function normalizeLocalPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

// Chevron SVG helper component for clean expandable animations
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'inline-block',
        marginLeft: '4px'
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
