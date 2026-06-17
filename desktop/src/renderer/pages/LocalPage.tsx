import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge } from '../components/StatusBadge';
import { asText, compactDate } from '../lib/formatting';
import { desktopApi } from '../lib/api';
import { auditRuleDefinition, type AuditFindingRecord } from '../../shared/local-audit';
import type { Phase3OperationResult, Phase3OperationResultStatus, ResourceChangeStatus } from '../../shared/local-phase3-operations';
import { redactForLog } from '../../shared/redaction';
import {
  AuthStatuses,
  AuditStatuses,
  LifecycleStatuses,
  LocalResourceTypes,
  PathStatuses,
  ResourceScopeTypes,
  SyncStatuses,
  auditStatusLabel,
  extractKitManifest,
  localResourceTypeLabel,
  type AggregatedResourceStatus,
  type FileBackedResource,
  type KitManifest,
  type KitResourceRef,
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

const BUILT_IN_AGENT_DEFINITIONS = [
  { id: 'claude-code', label: 'Claude Code', builtIn: true },
  { id: 'codex', label: 'Codex', builtIn: true },
  { id: 'gemini-cli', label: 'Gemini CLI', builtIn: true },
  { id: 'cursor', label: 'Cursor', builtIn: true },
  { id: 'antigravity', label: 'Antigravity', builtIn: true },
  { id: 'copilot', label: 'Copilot', builtIn: true },
  { id: 'windsurf', label: 'Windsurf', builtIn: true },
  { id: 'opencode', label: 'OpenCode', builtIn: true },
  { id: 'hermes', label: 'Hermes', builtIn: true }
] as const;

const CUSTOM_AGENT_DEFINITION = { id: 'custom-directory', label: '自定义目录', builtIn: false } as const;
const AGENT_DEFINITIONS = [...BUILT_IN_AGENT_DEFINITIONS, CUSTOM_AGENT_DEFINITION] as const;
const CUSTOM_AGENT_ID = CUSTOM_AGENT_DEFINITION.id;
type UiMessageTone = 'success' | 'error' | 'info' | 'warn';
interface UiMessage {
  tone: UiMessageTone;
  text: string;
}

const AGENT_DETAIL_TABS = [
  { id: 'overview', label: '总览' },
  { id: 'settings', label: '设置', resourceTypes: [LocalResourceTypes.AGENT_CONFIG] },
  { id: 'rules', label: '规则', resourceTypes: [LocalResourceTypes.RULE] },
  { id: 'subagents', label: '子智能体', resourceTypes: [LocalResourceTypes.SUBAGENT] },
  { id: 'memory', label: '记忆', resourceTypes: [LocalResourceTypes.MEMORY] },
  { id: 'extensions', label: '扩展', resourceTypes: [LocalResourceTypes.SKILL, LocalResourceTypes.MCP_SERVER, LocalResourceTypes.PLUGIN, LocalResourceTypes.HOOK, LocalResourceTypes.CLI_COMMAND] },
  { id: 'hooks', label: 'Hook', resourceTypes: [LocalResourceTypes.HOOK] },
  { id: 'cli', label: 'CLI', resourceTypes: [LocalResourceTypes.CLI_COMMAND] },
  { id: 'files', label: '文件' },
  { id: 'audit', label: '审计' },
  { id: 'events', label: '事件' }
] as const;

const PROJECT_DETAIL_TABS = [
  { id: 'overview', label: '总览' },
  { id: 'agents', label: '智能体' },
  { id: 'settings', label: '设置', resourceTypes: [LocalResourceTypes.AGENT_CONFIG] },
  { id: 'rules', label: '规则', resourceTypes: [LocalResourceTypes.RULE] },
  { id: 'memory', label: '记忆', resourceTypes: [LocalResourceTypes.MEMORY] },
  { id: 'subagents', label: '子智能体', resourceTypes: [LocalResourceTypes.SUBAGENT] },
  { id: 'ignore', label: 'Ignore', resourceTypes: [LocalResourceTypes.IGNORE_FILE] },
  { id: 'extensions', label: '扩展', resourceTypes: [LocalResourceTypes.SKILL, LocalResourceTypes.MCP_SERVER, LocalResourceTypes.PLUGIN] },
  { id: 'hooks', label: 'Hook', resourceTypes: [LocalResourceTypes.HOOK] },
  { id: 'cli', label: 'CLI', resourceTypes: [LocalResourceTypes.CLI_COMMAND] },
  { id: 'audit', label: '审计' },
  { id: 'events', label: '事件' }
] as const;

const EXTENSION_RESOURCE_TYPES: LocalResourceType[] = [LocalResourceTypes.SKILL, LocalResourceTypes.MCP_SERVER, LocalResourceTypes.PLUGIN, LocalResourceTypes.HOOK, LocalResourceTypes.CLI_COMMAND];
const PROJECT_BLOCKING_RESOURCE_TYPES: LocalResourceType[] = [
  LocalResourceTypes.AGENT_CONFIG,
  LocalResourceTypes.SKILL,
  LocalResourceTypes.MCP_SERVER,
  LocalResourceTypes.PLUGIN,
  LocalResourceTypes.HOOK,
  LocalResourceTypes.CLI_COMMAND,
  LocalResourceTypes.RULE,
  LocalResourceTypes.MEMORY,
  LocalResourceTypes.SUBAGENT,
  LocalResourceTypes.IGNORE_FILE,
  LocalResourceTypes.KIT
];

type AgentDashboardTab = typeof AGENT_DETAIL_TABS[number]['id'];
type ProjectDetailTab = typeof PROJECT_DETAIL_TABS[number]['id'];
type AgentDefinition = { id: string; label: string; builtIn: boolean };

type VisibleItem = {
  id: string;
  name: string;
  typeLabel: string;
  type: LocalResourceType | 'EVENT' | 'FINDING';
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
  finding?: AuditFindingRecord;
  agentId?: string;
  agentIds?: string[];
  projectId?: string;
  projectIds?: string[];
  kitId?: string;
  kitIds?: string[];
  platforms?: string[];
  builtIn?: boolean;
  syncStatus?: string;
  offlineCreated?: boolean;
  createdAt?: string;
  eventType?: string;
  severity?: string;
  ruleId?: string;
};

export function LocalPage({
  snapshot,
  activeTab,
  offline,
  localScanState,
  localScanSummary,
  localScanError,
  onChangeTab,
  onRefreshLocal,
  settingsConfig = {}
}: {
  snapshot: LocalResourceSnapshot;
  activeTab: LocalTab;
  offline: boolean;
  localScanState?: LoadState;
  localScanSummary?: LocalInventoryScanSummary;
  localScanError?: UiError;
  onChangeTab: (tab: LocalTab) => void;
  onRefreshLocal?: () => void;
  settingsConfig?: Record<string, unknown>;
}) {
  const [extensionQuery, setExtensionQuery] = useState('');
  const [extensionTypeFilter, setExtensionTypeFilter] = useState('全部');
  const [extensionAgentFilter, setExtensionAgentFilter] = useState('全部');
  const [extensionSourceFilter, setExtensionSourceFilter] = useState('全部');
  const [auditQuery, setAuditQuery] = useState('');
  const [auditTierFilter, setAuditTierFilter] = useState('全部');
  const [agentQuery, setAgentQuery] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [toolkitQuery, setToolkitQuery] = useState('');
  const [kitWorkbenchOpen, setKitWorkbenchOpen] = useState(false);
  const [selected, setSelected] = useState<VisibleItem | undefined>();
  const [selectedKitId, setSelectedKitId] = useState<string | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [agentDetailTab, setAgentDetailTab] = useState<AgentDashboardTab>('overview');
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [projectDetailTab, setProjectDetailTab] = useState<ProjectDetailTab>('overview');
  const [localAction, setLocalAction] = useState<{ busy: boolean; tone: UiMessageTone; text?: string }>({ busy: false, tone: 'info' });

  const activeNav = NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0];
  const agentItems = useMemo(() => createAgentItems(snapshot), [snapshot]);
  const extensionItems = useMemo(() => createExtensionItems(snapshot), [snapshot]);
  const projectItems = useMemo(() => createProjectItems(snapshot), [snapshot]);
  const kitItems = useMemo(() => createKitItems(snapshot), [snapshot]);
  const overviewItems = useMemo(() => createVisibleItems(snapshot, activeNav), [activeNav, snapshot]);
  const auditItems = useMemo(() => createVisibleItems(snapshot, activeNav), [activeNav, snapshot]);

  const filteredItems = useMemo(() => {
    if (activeTab === 'agents') return filterByQuery(agentItems, agentQuery);
    if (activeTab === 'extensions') {
      return extensionItems.filter((item) => (
        matchesQuery(item, extensionQuery)
        && (extensionTypeFilter === '全部' || item.typeLabel === extensionTypeFilter)
        && (extensionAgentFilter === '全部' || item.agentId === extensionAgentFilter || (item.agentIds ?? []).includes(extensionAgentFilter))
        && (extensionSourceFilter === '全部' || item.source === extensionSourceFilter)
      ));
    }
    if (activeTab === 'projects') return filterByQuery(projectItems, projectQuery);
    if (activeTab === 'toolkits') return filterByQuery(kitItems, toolkitQuery);
    if (activeTab === 'audit-events') {
      return auditItems.filter((item) => matchesQuery(item, auditQuery) && (auditTierFilter === '全部' || item.auditLabel === auditTierFilter || item.severity === auditTierFilter || item.status.label === auditTierFilter));
    }
    return overviewItems;
  }, [activeTab, agentItems, agentQuery, auditItems, auditQuery, auditTierFilter, extensionAgentFilter, extensionItems, extensionQuery, extensionSourceFilter, extensionTypeFilter, kitItems, overviewItems, projectItems, projectQuery, toolkitQuery]);

  const counts = useMemo(() => Object.fromEntries(NAV_ITEMS.map((item) => [item.id,
    item.id === 'agents' ? agentItems.length
      : item.id === 'extensions' ? extensionItems.length
        : item.id === 'projects' ? projectItems.length
          : item.id === 'toolkits' ? kitItems.length
          : createVisibleItems(snapshot, item).length
  ])), [agentItems.length, extensionItems.length, kitItems.length, projectItems.length, snapshot]);

  const extensionTypeOptions = uniqueOptions(extensionItems.map((item) => item.typeLabel));
  const extensionAgentOptions = uniqueOptions(extensionItems.flatMap((item) => item.agentIds ?? (item.agentId ? [item.agentId] : [])));
  const extensionSourceOptions = uniqueOptions(extensionItems.map((item) => item.source).filter((item): item is string => Boolean(item)));
  const auditTierOptions = uniqueOptions(auditItems.flatMap((item) => [item.auditLabel, item.severity, item.status.label].filter((value): value is string => Boolean(value))));

  const switchTab = (tab: LocalTab) => {
    onChangeTab(tab);
    setSelected(undefined);
    setSelectedKitId(undefined);
    setSelectedAgentId(undefined);
    setAgentDetailTab('overview');
    setSelectedProjectId(undefined);
    setProjectDetailTab('overview');
  };
  const runAllResourceAudit = async () => {
    setLocalAction({ busy: true, tone: 'info', text: '正在运行本地静态审计。' });
    try {
      const result = await desktopApi.local.runStaticAudit() as { audited: number; findingCount: number; failed: number };
      const message = staticAuditRunMessage(result);
      setLocalAction({
        busy: false,
        tone: message.tone,
        text: message.text
      });
      onRefreshLocal?.();
    } catch (error) {
      setLocalAction({ busy: false, tone: 'error', text: error instanceof Error ? error.message : '本地静态审计失败' });
    }
  };
  const showImportPanel = () => {
    setKitWorkbenchOpen(true);
    setLocalAction({ busy: false, tone: 'info', text: '请在工具集页展开 Kit 生成与导入面板，粘贴 KitManifest JSON 后执行真实导入。' });
    if (typeof document !== 'undefined') {
      document.querySelector('[data-testid="kit-workbench"]')?.scrollIntoView({ block: 'start' });
    }
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

        <header className="local-page-header" aria-label={`${activeNav.label}本地工作台`}>
          <div>
            <h2>{activeNav.label}</h2>
            <span className="meta" data-testid="local-scan-summary">{formatScanSummary(localScanState, localScanSummary, snapshot)}</span>
            <p className="muted">
              {offline ? '当前离线：新增服务端动作已暂停。' : '在线状态可用；当前展示真实扫描、Path Profile、审计摘要和本地事件。'}
              {' '}待同步事件 {snapshot.summary.pendingSyncEvents}，失败状态 {snapshot.summary.failureCount}。
            </p>
            {localAction.text ? <p className="muted" role="status" style={messageStyle(localAction.tone)}>{localAction.text}</p> : null}
          </div>
          <div className="card-action-row">
            <Button tone="primary" onClick={onRefreshLocal} data-testid="local-rescan">重新扫描</Button>
            <Button disabled={localAction.busy} onClick={runAllResourceAudit} data-testid="local-run-audit">运行审计</Button>
            <Button disabled title="检查更新需要扩展服务端授权和版本源配置">检查更新</Button>
            <Button disabled={activeTab !== 'toolkits'} onClick={showImportPanel} title={activeTab === 'toolkits' ? '打开工具集页真实导入入口；导入写入仍需要 ExecutionPlan、备份和回滚' : '导入会写入本地资源，需要 ExecutionPlan、备份和回滚接入'}>导入</Button>
          </div>
        </header>

        <LocalTabToolbar
          activeTab={activeTab}
          filteredCount={filteredItems.length}
          extensionQuery={extensionQuery}
          extensionTypeFilter={extensionTypeFilter}
          extensionAgentFilter={extensionAgentFilter}
          extensionSourceFilter={extensionSourceFilter}
          extensionTypeOptions={extensionTypeOptions}
          extensionAgentOptions={extensionAgentOptions}
          extensionSourceOptions={extensionSourceOptions}
          auditQuery={auditQuery}
          auditTierFilter={auditTierFilter}
          auditTierOptions={auditTierOptions}
          agentQuery={agentQuery}
          projectQuery={projectQuery}
          toolkitQuery={toolkitQuery}
          kitWorkbenchOpen={kitWorkbenchOpen}
          onExtensionQuery={setExtensionQuery}
          onExtensionTypeFilter={setExtensionTypeFilter}
          onExtensionAgentFilter={setExtensionAgentFilter}
          onExtensionSourceFilter={setExtensionSourceFilter}
          onAuditQuery={setAuditQuery}
          onAuditTierFilter={setAuditTierFilter}
          onAgentQuery={setAgentQuery}
          onProjectQuery={setProjectQuery}
          onToolkitQuery={setToolkitQuery}
          onToggleKitWorkbench={() => setKitWorkbenchOpen((open) => !open)}
        />

        <section className="panel" style={{ flex: 1, overflowY: 'auto', padding: '12px', margin: 0 }} aria-label={`${activeNav.label}列表`}>
          {activeTab === 'overview' ? (
            <LocalOverview snapshot={snapshot} offline={offline} items={filteredItems} onSelectResource={setSelected} />
          ) : activeTab === 'agents' ? (
            <AgentDashboard
              agentItems={filteredItems}
              snapshot={snapshot}
              selectedAgentId={selectedAgentId}
              activeDetailTab={agentDetailTab}
              localScanState={localScanState}
              settingsConfig={settingsConfig}
              onSelectAgent={(agentId) => {
                setSelectedAgentId(agentId);
                setAgentDetailTab('overview');
              }}
              onSelectDetailTab={setAgentDetailTab}
              onSelectResource={setSelected}
              onRefreshLocal={onRefreshLocal}
            />
          ) : activeTab === 'projects' ? (
            <ProjectPage
              projectItems={filteredItems}
              snapshot={snapshot}
              selectedProjectId={selectedProjectId}
              activeDetailTab={projectDetailTab}
              localScanState={localScanState}
              onSelectProject={(projectId) => {
                setSelectedProjectId(projectId);
                setProjectDetailTab('overview');
              }}
              onSelectDetailTab={setProjectDetailTab}
              onSelectResource={setSelected}
              onRefreshLocal={onRefreshLocal}
            />
          ) : activeTab === 'toolkits' ? (
            <ToolkitPage
              kitItems={filteredItems}
              snapshot={snapshot}
              selectedKitId={selectedKitId}
              workbenchOpen={kitWorkbenchOpen}
              onSelectKit={setSelectedKitId}
              onSelectResource={setSelected}
              onRefreshLocal={onRefreshLocal}
            />
          ) : filteredItems.length === 0 ? (
            <EmptyState title={`暂无${activeNav.label}资源`} message={emptyMessage(activeTab, localScanState, snapshot)} />
          ) : (
            <VisibleItemsTable items={filteredItems} onSelect={setSelected} />
          )}
        </section>
      </div>

      {selected ? <LocalResourceDrawer item={selected} snapshot={snapshot} onSelectResource={setSelected} onRefreshLocal={onRefreshLocal} onClose={() => setSelected(undefined)} /> : null}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: string[]; onChange: (value: string) => void; testId: string }) {
  return (
    <label className="local-filter-select">
      <span className="filter-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} disabled={options.length <= 1}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function LocalTabToolbar({
  activeTab,
  filteredCount,
  extensionQuery,
  extensionTypeFilter,
  extensionAgentFilter,
  extensionSourceFilter,
  extensionTypeOptions,
  extensionAgentOptions,
  extensionSourceOptions,
  auditQuery,
  auditTierFilter,
  auditTierOptions,
  agentQuery,
  projectQuery,
  toolkitQuery,
  kitWorkbenchOpen,
  onExtensionQuery,
  onExtensionTypeFilter,
  onExtensionAgentFilter,
  onExtensionSourceFilter,
  onAuditQuery,
  onAuditTierFilter,
  onAgentQuery,
  onProjectQuery,
  onToolkitQuery,
  onToggleKitWorkbench
}: {
  activeTab: LocalTab;
  filteredCount: number;
  extensionQuery: string;
  extensionTypeFilter: string;
  extensionAgentFilter: string;
  extensionSourceFilter: string;
  extensionTypeOptions: string[];
  extensionAgentOptions: string[];
  extensionSourceOptions: string[];
  auditQuery: string;
  auditTierFilter: string;
  auditTierOptions: string[];
  agentQuery: string;
  projectQuery: string;
  toolkitQuery: string;
  kitWorkbenchOpen: boolean;
  onExtensionQuery: (value: string) => void;
  onExtensionTypeFilter: (value: string) => void;
  onExtensionAgentFilter: (value: string) => void;
  onExtensionSourceFilter: (value: string) => void;
  onAuditQuery: (value: string) => void;
  onAuditTierFilter: (value: string) => void;
  onAgentQuery: (value: string) => void;
  onProjectQuery: (value: string) => void;
  onToolkitQuery: (value: string) => void;
  onToggleKitWorkbench: () => void;
}) {
  if (activeTab === 'extensions') {
    return (
      <section className="local-tab-toolbar" data-testid="local-extensions-toolbar" aria-label="扩展页工具栏">
        <span className="sr-only">类型 智能体 来源</span>
        <SearchControl label="搜索扩展" value={extensionQuery} onChange={onExtensionQuery} />
        <CompactSelect label="类型" value={extensionTypeFilter} options={extensionTypeOptions} onChange={onExtensionTypeFilter} testId="local-extension-type-filter" />
        {extensionAgentOptions.length > 1 ? <CompactSelect label="智能体" value={extensionAgentFilter} options={extensionAgentOptions} onChange={onExtensionAgentFilter} testId="local-extension-agent-filter" /> : null}
        {extensionSourceOptions.length > 1 ? <CompactSelect label="来源" value={extensionSourceFilter} options={extensionSourceOptions} onChange={onExtensionSourceFilter} testId="local-extension-source-filter" /> : null}
        <span className="meta">{filteredCount} 项</span>
      </section>
    );
  }
  if (activeTab === 'audit-events') {
    return (
      <section className="local-tab-toolbar" data-testid="local-audit-toolbar" aria-label="审计与事件工具栏">
        <SearchControl label="搜索审计与事件" value={auditQuery} onChange={onAuditQuery} />
        <CompactSelect label="风险" value={auditTierFilter} options={auditTierOptions} onChange={onAuditTierFilter} testId="local-audit-tier-filter" />
        <span className="meta">{filteredCount} 项</span>
      </section>
    );
  }
  if (activeTab === 'agents') {
    return <section className="local-tab-toolbar" data-testid="local-agent-toolbar" aria-label="智能体工具栏"><SearchControl label="搜索智能体" value={agentQuery} onChange={onAgentQuery} /><span className="meta">{filteredCount} 项</span></section>;
  }
  if (activeTab === 'projects') {
    return <section className="local-tab-toolbar" data-testid="local-project-toolbar" aria-label="项目工具栏"><SearchControl label="搜索项目" value={projectQuery} onChange={onProjectQuery} /><span className="meta">{filteredCount} 项</span></section>;
  }
  if (activeTab === 'toolkits') {
    return (
      <section className="local-tab-toolbar" data-testid="local-toolkit-toolbar" aria-label="工具集工具栏">
        <SearchControl label="搜索工具集" value={toolkitQuery} onChange={onToolkitQuery} />
        <Button onClick={onToggleKitWorkbench}>{kitWorkbenchOpen ? '收起 Kit 生成与导入' : '展开导入 Kit'}</Button>
        {!kitWorkbenchOpen ? (
          <>
            <Button onClick={onToggleKitWorkbench}>生成 Kit：从智能体生成</Button>
            <Button onClick={onToggleKitWorkbench}>生成 Kit：从项目生成</Button>
          </>
        ) : null}
        <span className="meta">{filteredCount} 项</span>
      </section>
    );
  }
  return null;
}

function SearchControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="local-filter-select">
      <span className="filter-label">{label}</span>
      <input className="input" type="search" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function CompactSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: string[]; onChange: (value: string) => void; testId: string }) {
  if (options.length <= 1) return null;
  return <FilterSelect label={label} value={value} options={options} onChange={onChange} testId={testId} />;
}

function VisibleItemsTable({ items, onSelect }: { items: VisibleItem[]; onSelect: (item: VisibleItem) => void }) {
  return (
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
        {items.map((item) => (
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
              <Button tone="ghost" onClick={() => onSelect(item)} data-testid={`local-detail-${safeId(item.id)}`}>详情</Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LocalOverview({ snapshot, offline, items, onSelectResource }: { snapshot: LocalResourceSnapshot; offline: boolean; items: VisibleItem[]; onSelectResource: (item: VisibleItem) => void }) {
  const agentCount = unique((snapshot.bindings ?? []).flatMap((binding) => binding.agentId ? [binding.agentId] : [])).length
    || (snapshot.resources ?? []).filter((resource) => resource.type === LocalResourceTypes.AGENT).length;
  const extensionCount = (snapshot.resources ?? []).filter((resource) => isExtensionResource(resource.type)).length;
  const projectCount = unique([
    ...(snapshot.bindings ?? []).flatMap((binding) => binding.projectId ? [binding.projectId] : []),
    ...(snapshot.resources ?? []).filter((resource) => resource.type === LocalResourceTypes.PROJECT).flatMap((resource) => resource.sourceId ? [resource.sourceId] : [resource.id])
  ]).length;
  const kitCount = (snapshot.resources ?? []).filter((resource) => resource.type === LocalResourceTypes.KIT).length;
  const riskCount = items.filter((item) => item.status.tone === 'danger' || item.auditStatus === AuditStatuses.HIGH_RISK || item.auditStatus === AuditStatuses.SECURITY_RISK).length
    || (snapshot.findings ?? []).filter((finding) => finding.blocker || finding.severity === 'critical' || finding.severity === 'high').length;
  const recentEvents = (snapshot.events ?? []).slice(0, 5);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} data-testid="local-overview-summary">
      <section className="panel">
        <h3>本地资源摘要</h3>
        <table className="table compact-table">
          <tbody>
            <tr>
              <td>智能体</td>
              <td>{agentCount}</td>
              <td>扩展</td>
              <td>{extensionCount}</td>
            </tr>
            <tr>
              <td>项目</td>
              <td>{projectCount}</td>
              <td>工具集</td>
              <td>{kitCount}</td>
            </tr>
            <tr>
              <td>风险</td>
              <td>{riskCount}</td>
              <td>事件</td>
              <td>{snapshot.summary.eventCount}</td>
            </tr>
            <tr>
              <td>离线状态</td>
              <td>{offline ? '离线' : '在线'}</td>
              <td>待同步</td>
              <td>{snapshot.summary.pendingSyncEvents}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>风险与最近事件</h3>
        {recentEvents.length === 0 ? <p className="muted">暂无本地事件。</p> : (
          <table className="table compact-table">
            <tbody>
              {recentEvents.map((event) => (
                <tr key={event.eventId}>
                  <td>{event.eventType}</td>
                  <td>{event.status}</td>
                  <td>{event.message}</td>
                  <td>{compactDate(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {items.length === 0 ? <EmptyState title="未发现可展示资源" message={emptyMessage('overview', 'ready', snapshot)} /> : <VisibleItemsTable items={items.slice(0, 8)} onSelect={onSelectResource} />}
    </div>
  );
}

function AgentDashboard({
  agentItems,
  snapshot,
  selectedAgentId,
  activeDetailTab,
  localScanState,
  settingsConfig,
  onSelectAgent,
  onSelectDetailTab,
  onSelectResource,
  onRefreshLocal
}: {
  agentItems: VisibleItem[];
  snapshot: LocalResourceSnapshot;
  selectedAgentId?: string;
  activeDetailTab: AgentDashboardTab;
  localScanState?: LoadState;
  settingsConfig: Record<string, unknown>;
  onSelectAgent: (agentId: string) => void;
  onSelectDetailTab: (tab: AgentDashboardTab) => void;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  if (agentItems.length === 0) {
    return <EmptyState title="暂无智能体资源" message={emptyMessage('agents', localScanState, snapshot)} />;
  }

  const defaultAgentId = agentItems.find((item) => item.agentId === CUSTOM_AGENT_ID && item.status.key === 'not_configured')?.agentId;
  const selectedAgent = agentItems.find((item) => item.agentId === (selectedAgentId ?? defaultAgentId)) ?? agentItems[0];
  const detailAgentId = selectedAgent.agentId ?? AGENT_DEFINITIONS[0].id;
  const detailRows = rowsForAgent(snapshot, detailAgentId);
  const detailEvents = eventsForAgent(snapshot, detailAgentId);
  const definition = definitionForAgent(detailAgentId);

  return (
    <div className="local-split-layout" data-testid="agent-dashboard">
      <aside className="local-split-list" data-testid="local-agent-list" aria-label="智能体列表">
        <VisibleItemsTable
          items={agentItems}
          onSelect={(item) => {
            if (item.agentId) onSelectAgent(item.agentId);
            else onSelectResource(item);
          }}
        />
      </aside>

      <div className="local-split-detail" aria-label={`${selectedAgent.name}详情`} data-testid="local-agent-detail">
        <header className="section-header">
          <div>
            <h2>{selectedAgent.name}</h2>
            <span className="meta">
              {definition?.builtIn ? '内置智能体' : '自定义目录 Agent Profile'} · {detailAgentId}
            </span>
          </div>
          <StatusBadge tone={selectedAgent.status.tone}>{selectedAgent.status.label}</StatusBadge>
        </header>

        <div className="filter-bar" role="tablist" aria-label="智能体详情 Tab" style={{ margin: '12px 0' }}>
          {AGENT_DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeDetailTab === tab.id}
              className={`saas-sidebar-item ${activeDetailTab === tab.id ? 'active' : ''}`}
              style={{ width: 'auto' }}
              onClick={() => onSelectDetailTab(tab.id)}
              data-testid={`agent-tab-${tab.id}`}
            >
              <span className="saas-sidebar-item-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <AgentTabContent
          agent={selectedAgent}
          definition={definition}
          rows={detailRows}
          events={detailEvents}
          snapshot={snapshot}
          activeTab={activeDetailTab}
          settingsConfig={settingsConfig}
          onSelectResource={onSelectResource}
          onRefreshLocal={onRefreshLocal}
        />
      </div>
    </div>
  );
}

function AgentTabContent({
  agent,
  definition,
  rows,
  events,
  snapshot,
  activeTab,
  settingsConfig,
  onSelectResource,
  onRefreshLocal
}: {
  agent: VisibleItem;
  definition?: AgentDefinition;
  rows: LocalResourceRow[];
  events: LocalEventRecord[];
  snapshot: LocalResourceSnapshot;
  activeTab: AgentDashboardTab;
  settingsConfig: Record<string, unknown>;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  const tabDefinition = AGENT_DETAIL_TABS.find((tab) => tab.id === activeTab);
  if (activeTab === 'overview') {
    return <AgentOverview agent={agent} definition={definition} rows={rows} events={events} snapshot={snapshot} settingsConfig={settingsConfig} onSelectResource={onSelectResource} onRefreshLocal={onRefreshLocal} />;
  }
  if (activeTab === 'files') {
    return <AgentFilesTable rows={rows} onSelectResource={onSelectResource} />;
  }
  if (activeTab === 'events') {
    return <AgentEventsTable events={events} onSelectResource={onSelectResource} />;
  }
  if (activeTab === 'audit') {
    const auditRows = rows.filter((row) => row.resource.auditSummary.status !== AuditStatuses.NOT_AUDITED || row.events.some((event) => event.eventType.includes('AUDIT') || event.status === 'failure'));
    return <AgentRowsTable rows={auditRows.length > 0 ? auditRows : rows} emptyTitle="暂无审计记录" emptyMessage="该智能体当前没有审计发现；未审计状态会保持可见，不会默认正常。" onSelectResource={onSelectResource} />;
  }
  const resourceTypes = (tabDefinition && 'resourceTypes' in tabDefinition ? tabDefinition.resourceTypes : undefined) as readonly LocalResourceType[] | undefined;
  const filteredRows = resourceTypes ? rows.filter((row) => resourceTypes.includes(row.resource.type)) : rows;
  return (
    <AgentRowsTable
      rows={filteredRows}
      emptyTitle={`暂无${tabDefinition?.label ?? '资源'}资源`}
      emptyMessage="该能力未检测、未配置或不适用；Dashboard 结构保持可见。"
      onSelectResource={onSelectResource}
    />
  );
}

function AgentOverview({
  agent,
  definition,
  rows,
  events,
  snapshot,
  settingsConfig,
  onSelectResource,
  onRefreshLocal
}: {
  agent: VisibleItem;
  definition?: AgentDefinition;
  rows: LocalResourceRow[];
  events: LocalEventRecord[];
  snapshot: LocalResourceSnapshot;
  settingsConfig: Record<string, unknown>;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  const agentResource = agent.row?.resource;
  const profile = asRecord(agentResource?.metadata.pathProfile);
  const capabilityStatus = asRecord(profile?.capabilityStatus);
  const auditSummary = summarizeAudit(rows);
  const permissionSummary = summarizePermissions(rows);
  const recentEvents = events.slice(0, 4);
  const hasConfiguredCustomProfile = !definition?.builtIn && Boolean(agentResource?.metadata.customProfileConfigured ?? rows.some((row) => row.resource.type !== LocalResourceTypes.AGENT));
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <table className="table compact-table" data-testid="agent-overview-matrix">
        <tbody>
          <tr>
            <td>全局作用域</td>
            <td>{rows.filter(isGlobalScopeRow).length || '未检测'}</td>
            <td>项目作用域</td>
            <td>{rows.filter(isProjectScopeRow).length || '未检测'}</td>
          </tr>
          <tr>
            <td>路径状态</td>
            <td>{agent.status.label}</td>
            <td>权限摘要</td>
            <td>{permissionSummary}</td>
          </tr>
          <tr>
            <td>审计摘要</td>
            <td>{auditSummary}</td>
            <td>最近事件</td>
            <td>{recentEvents.length > 0 ? `${recentEvents.length} 条配置事件` : '暂无事件'}</td>
          </tr>
          <tr>
            <td>Path Profile</td>
            <td colSpan={3}>{formatPathProfile(profile)}</td>
          </tr>
        </tbody>
      </table>

      <div>
        <h3>能力矩阵</h3>
        <table className="table compact-table" data-testid="agent-capability-matrix">
          <tbody>
            {[
              ['settings', '设置'],
              ['rules', '规则'],
              ['subagents', '子智能体'],
              ['memory', '记忆'],
              ['ignore-files', 'Ignore Files'],
              ['skills', 'Skill'],
              ['mcp', 'MCP'],
              ['plugins', 'Plugin'],
              ['hooks', 'Hook'],
              ['cli', 'CLI'],
              ['files', '文件']
            ].map(([kind, label]) => (
              <tr key={kind}>
                <td>{label}</td>
                <td>{capabilityLabel(capabilityStatus?.[kind])}</td>
                <td>{resourceCountForKind(rows, kind)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!definition?.builtIn ? (
        <section className="panel" data-testid="custom-agent-profile-summary">
          <header className="section-header">
            <div>
              <h3>Agent Profile 配置</h3>
              <p className="muted">{hasConfiguredCustomProfile ? '已配置自定义目录 Profile；可展开编辑静态 Path Profile。' : '未配置路径规则；需要显式展开后再配置。'}</p>
            </div>
            <Button onClick={() => setProfileEditorOpen((open) => !open)}>{profileEditorOpen ? '收起配置' : hasConfiguredCustomProfile ? '编辑 Agent Profile' : '添加 Agent Profile'}</Button>
          </header>
          {profileEditorOpen ? (
            <CustomAgentProfileEditor
              configured={hasConfiguredCustomProfile}
              agent={agent}
              definition={definition}
              profile={profile}
              settingsConfig={settingsConfig}
              onCancel={() => setProfileEditorOpen(false)}
              onRefreshLocal={onRefreshLocal}
            />
          ) : null}
        </section>
      ) : null}

      <div>
        <h3>最近资源</h3>
        <AgentRowsTable rows={rows.slice(0, 5)} emptyTitle="暂无智能体资源" emptyMessage="该智能体尚未扫描到配置、规则、扩展或文件。" onSelectResource={onSelectResource} />
      </div>

      <div>
        <h3>最近事件</h3>
        <AgentEventsTable events={recentEvents} onSelectResource={onSelectResource} />
      </div>
    </div>
  );
}

function AgentRowsTable({ rows, emptyTitle, emptyMessage, onSelectResource }: { rows: LocalResourceRow[]; emptyTitle: string; emptyMessage: string; onSelectResource: (item: VisibleItem) => void }) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} message={emptyMessage} />;
  return <VisibleItemsTable items={rows.map(rowToItem)} onSelect={onSelectResource} />;
}

function AgentFilesTable({ rows, onSelectResource }: { rows: LocalResourceRow[]; onSelectResource: (item: VisibleItem) => void }) {
  const fileItems = rows.flatMap((row) => row.files.map((file) => fileToItem(file, row)));
  if (fileItems.length === 0) {
    return <EmptyState title="暂无文件资源" message="未扫描到可预览文件；目录缺失、权限不足或不适用会保持明确状态。" />;
  }
  return <VisibleItemsTable items={fileItems} onSelect={onSelectResource} />;
}

function AgentEventsTable({ events, onSelectResource }: { events: LocalEventRecord[]; onSelectResource: (item: VisibleItem) => void }) {
  if (events.length === 0) {
    return <EmptyState title="暂无事件" message="该智能体没有统一 LocalEvent 记录；Hook 和 CLI 只展示配置事件，不展示运行时触发或调用事件。" />;
  }
  return <VisibleItemsTable items={events.map(eventToItem)} onSelect={onSelectResource} />;
}

function ProjectPage({
  projectItems,
  snapshot,
  selectedProjectId,
  activeDetailTab,
  localScanState,
  onSelectProject,
  onSelectDetailTab,
  onSelectResource,
  onRefreshLocal
}: {
  projectItems: VisibleItem[];
  snapshot: LocalResourceSnapshot;
  selectedProjectId?: string;
  activeDetailTab: ProjectDetailTab;
  localScanState?: LoadState;
  onSelectProject: (projectId: string) => void;
  onSelectDetailTab: (tab: ProjectDetailTab) => void;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  if (projectItems.length === 0) {
    return <EmptyState title="暂无项目资源" message={emptyMessage('projects', localScanState, snapshot)} />;
  }
  const selectedProject = projectItems.find((item) => item.projectId === selectedProjectId) ?? projectItems[0];
  const projectId = selectedProject.projectId ?? selectedProject.row?.binding?.projectId ?? selectedProject.row?.resource.sourceId ?? selectedProject.id;
  const projectRows = rowsForProject(snapshot, projectId);
  const projectEvents = eventsForProject(snapshot, projectId);

  return (
    <div className="local-split-layout" data-testid="project-page">
      <aside className="local-split-list" data-testid="local-project-list" aria-label="项目列表">
        <VisibleItemsTable
          items={projectItems}
          onSelect={(item) => {
            if (item.projectId) onSelectProject(item.projectId);
            else onSelectResource(item);
          }}
        />
      </aside>
      <div className="local-split-detail" aria-label={`${selectedProject.name}项目详情`} data-testid="local-project-detail">
        <header className="section-header">
          <div>
            <h2>{selectedProject.name}</h2>
            <span className="meta">{projectId} · {selectedProject.path ?? '路径未知'}</span>
          </div>
          <StatusBadge tone={selectedProject.status.tone}>{selectedProject.status.label}</StatusBadge>
        </header>
        <div className="filter-bar" role="tablist" aria-label="项目详情 Tab" style={{ margin: '12px 0' }}>
          {PROJECT_DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeDetailTab === tab.id}
              className={`saas-sidebar-item ${activeDetailTab === tab.id ? 'active' : ''}`}
              style={{ width: 'auto' }}
              onClick={() => onSelectDetailTab(tab.id)}
              data-testid={`project-tab-${tab.id}`}
            >
              <span className="saas-sidebar-item-label">{tab.label}</span>
            </button>
          ))}
        </div>
        <ProjectTabContent
          project={selectedProject}
          projectId={projectId}
          rows={projectRows}
          events={projectEvents}
          snapshot={snapshot}
          activeTab={activeDetailTab}
          onSelectResource={onSelectResource}
          onRefreshLocal={onRefreshLocal}
        />
      </div>
    </div>
  );
}

function ProjectTabContent({
  project,
  projectId,
  rows,
  events,
  snapshot,
  activeTab,
  onSelectResource,
  onRefreshLocal
}: {
  project: VisibleItem;
  projectId: string;
  rows: LocalResourceRow[];
  events: LocalEventRecord[];
  snapshot: LocalResourceSnapshot;
  activeTab: ProjectDetailTab;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  if (activeTab === 'overview') {
    return <ProjectOverview project={project} projectId={projectId} rows={rows} events={events} snapshot={snapshot} onSelectResource={onSelectResource} onRefreshLocal={onRefreshLocal} />;
  }
  if (activeTab === 'events') {
    return events.length === 0
      ? <EmptyState title="暂无项目事件" message="该项目没有本地事件；路径异常、删除尝试、Kit 应用和写入失败会进入 LocalEvent。" />
      : <VisibleItemsTable items={events.map(eventToItem)} onSelect={onSelectResource} />;
  }
  if (activeTab === 'audit') {
    const auditRows = rows.filter((row) => row.resource.auditSummary.status !== AuditStatuses.NOT_AUDITED || row.events.some((event) => event.eventType.includes('AUDIT') || event.status === 'failure'));
    return <AgentRowsTable rows={auditRows.length > 0 ? auditRows : rows.filter((row) => row.resource.type !== LocalResourceTypes.PROJECT)} emptyTitle="暂无项目审计" emptyMessage="未审计状态保持可见，不会默认显示为正常。" onSelectResource={onSelectResource} />;
  }
  if (activeTab === 'agents') {
    const agents = unique(rows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
    if (agents.length === 0) return <EmptyState title="暂无关联智能体" message="项目尚未绑定智能体资源；关联关系必须来自 ResourceBinding。" />;
    return (
      <table className="table compact-table" data-testid="project-agents">
        <tbody>
          {agents.map((agentId) => (
            <tr key={agentId}>
              <td>{agentId}</td>
              <td>{rows.filter((row) => row.binding?.agentId === agentId).length} 个资源</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const definition = PROJECT_DETAIL_TABS.find((tab) => tab.id === activeTab);
  const resourceTypes = definition && 'resourceTypes' in definition ? definition.resourceTypes as readonly LocalResourceType[] | undefined : undefined;
  const filteredRows = resourceTypes
    ? rows.filter((row) => resourceTypes.includes(row.resource.type))
    : rows.filter((row) => row.resource.type !== LocalResourceTypes.PROJECT);
  return (
    <AgentRowsTable
      rows={filteredRows}
      emptyTitle={`暂无项目${definition?.label ?? '资源'}`}
      emptyMessage="该项目作用域下未检测到此类资源；缺失路径仍会展示清理指引。"
      onSelectResource={onSelectResource}
    />
  );
}

function ProjectOverview({
  project,
  projectId,
  rows,
  events,
  snapshot,
  onSelectResource,
  onRefreshLocal
}: {
  project: VisibleItem;
  projectId: string;
  rows: LocalResourceRow[];
  events: LocalEventRecord[];
  snapshot: LocalResourceSnapshot;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  const projectRow = rows.find((row) => row.resource.type === LocalResourceTypes.PROJECT) ?? project.row;
  const associatedRows = rows.filter((row) => row.resource.type !== LocalResourceTypes.PROJECT);
  const agents = unique(associatedRows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
  const auditRisk = summarizeAudit(associatedRows.length > 0 ? associatedRows : rows);
  const pendingEvents = events.filter((event) => event.syncStatus === SyncStatuses.PENDING_SYNC);
  const blockers = projectRemovalBlockers(rows);
  const pathStatus = projectRow?.binding?.pathStatus;
  const pathMissing = pathStatus === PathStatuses.MISSING || pathStatus === PathStatuses.INVALID || pathStatus === PathStatuses.NOT_WRITABLE || pathStatus === PathStatuses.CONFLICT;
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeMessage, setRemoveMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | undefined>();
  const removeProjectRecord = async () => {
    setRemoveBusy(true);
    setRemoveMessage(undefined);
    try {
      const result = await desktopApi.local.removeProjectRecord({ projectId }) as { removed: boolean; validation: { cleanupGuidance?: string } };
      setRemoveMessage(result.removed
        ? { tone: 'success', text: '已删除本地项目管理记录，真实项目目录保持不变。' }
        : { tone: 'error', text: result.validation.cleanupGuidance ?? '项目管理记录删除被后端阻断。' });
      onRefreshLocal?.();
    } catch (error) {
      setRemoveMessage({ tone: 'error', text: error instanceof Error ? error.message : '项目管理记录删除失败' });
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <table className="table compact-table" data-testid="project-overview">
        <tbody>
          <tr>
            <td>项目路径</td>
            <td>{project.path ?? projectRow?.binding?.targetPath ?? projectRow?.resource.sourcePath ?? '路径未知'}</td>
            <td>路径状态</td>
            <td>{pathStatus ?? project.status.label}</td>
          </tr>
          <tr>
            <td>关联智能体</td>
            <td>{agents.length > 0 ? agents.join(' / ') : '未关联'}</td>
            <td>项目级资源数量</td>
            <td>{associatedRows.length}</td>
          </tr>
          <tr>
            <td>审计风险</td>
            <td>{auditRisk}</td>
            <td>待同步事件</td>
            <td>{pendingEvents.length}</td>
          </tr>
          <tr>
            <td>最近事件</td>
            <td colSpan={3}>{events.length > 0 ? `${events.slice(0, 3).map((event) => event.eventType).join(' / ')}` : '暂无事件'}</td>
          </tr>
        </tbody>
      </table>

      <section className="panel">
        <h3>删除保护</h3>
        <p className="muted">
          删除项目只删除本地管理记录，不删除真实项目目录。删除前必须清理项目下仍有关联的 Settings、Skill、MCP、Plugin、Hook、CLI、Rule、Memory、Subagent、Ignore 或 Kit 应用记录。
        </p>
        {blockers.length > 0 ? (
          <>
            <StatusBadge tone="warn">阻断删除</StatusBadge>
            <table className="table compact-table" data-testid="project-removal-blockers">
              <tbody>
                {blockers.slice(0, 8).map((row) => (
                  <tr key={row.binding?.id ?? row.resource.id}>
                    <td>{row.resource.displayName}</td>
                    <td>{localResourceTypeLabel(row.resource.type)}</td>
                    <td>{row.binding?.agentId ?? '项目作用域'}</td>
                    <td>{row.status.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">请先停用、卸载、解除接入、移除 Kit 应用或清理本地记录；路径不存在时仍需按资源清理关联记录。</p>
          </>
        ) : (
          <p className="muted">未发现阻断资源；可通过事务链删除本地项目管理记录，真实目录保持不变。</p>
        )}
        {pathMissing ? <p className="muted">项目路径异常：即使路径不存在，仍需按上方关联资源完成清理。</p> : null}
        {removeMessage ? <p className="muted" role="status" style={removeMessage.tone === 'error' ? { color: 'var(--ea-error-text)' } : undefined}>{removeMessage.text}</p> : null}
        <div className="card-action-row">
          <Button tone="danger" disabled={removeBusy} onClick={removeProjectRecord}>删除管理记录</Button>
        </div>
      </section>

      <div>
        <h3>项目资源</h3>
        <AgentRowsTable rows={associatedRows.slice(0, 8)} emptyTitle="暂无项目资源" emptyMessage="项目记录存在，但尚未绑定项目级智能体资源。" onSelectResource={onSelectResource} />
      </div>

      <div>
        <h3>跨页一致性</h3>
        <p className="muted">当前项目详情、智能体 Dashboard、扩展页和工具集页均从同一 LocalResourceSnapshot 读取。全局资源 {snapshot.summary.resourceCount}，绑定 {snapshot.summary.bindingCount}。</p>
      </div>
    </div>
  );
}

function ToolkitPage({
  kitItems,
  snapshot,
  selectedKitId,
  workbenchOpen,
  onSelectKit,
  onSelectResource,
  onRefreshLocal
}: {
  kitItems: VisibleItem[];
  snapshot: LocalResourceSnapshot;
  selectedKitId?: string;
  workbenchOpen: boolean;
  onSelectKit: (kitId: string) => void;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  const selectedKit = kitItems.find((item) => item.kitId === selectedKitId) ?? kitItems[0];
  const manifest = selectedKit ? extractKitManifest(selectedKit.row?.resource.metadata) : undefined;
  const compactKitActions = compactKitActionSummary(snapshot, manifest);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} data-testid="toolkit-page">
      {workbenchOpen ? <KitWorkbench snapshot={snapshot} selectedManifest={manifest} onRefreshLocal={onRefreshLocal} /> : compactKitActions ? <p className="muted">{compactKitActions}</p> : null}
      {kitItems.length === 0 ? (
        <EmptyState title="暂无工具集资源" message="没有符合当前页面和筛选条件的真实本地资源；可通过上方 Kit 生成与导入操作展开真实 IPC 导入入口。" />
      ) : (
        <>
          <VisibleItemsTable
            items={kitItems}
            onSelect={(item) => {
              if (item.kitId) onSelectKit(item.kitId);
              else onSelectResource(item);
            }}
          />
          {manifest && selectedKit ? (
            <KitDetail
              item={selectedKit}
              manifest={manifest}
              snapshot={snapshot}
              onSelectResource={onSelectResource}
            />
          ) : (
            <EmptyState title="Kit manifest 缺失" message="当前记录没有有效 KitManifest；不会作为工具集运行路径处理。" />
          )}
        </>
      )}
    </div>
  );
}

function compactKitActionSummary(snapshot: LocalResourceSnapshot, manifest?: KitManifest): string {
  const agentId = manifest?.supportedAgents[0] ?? snapshot.rows.find((row) => row.binding?.agentId)?.binding?.agentId;
  const projectId = snapshot.rows.find((row) => row.binding?.projectId)?.binding?.projectId;
  return [
    agentId ? `默认智能体生成 ID：kit.${agentId}` : undefined,
    projectId ? `默认项目生成 ID：kit.${projectId}` : undefined
  ].filter(Boolean).join('；');
}

function KitWorkbench({ snapshot, selectedManifest, onRefreshLocal }: { snapshot: LocalResourceSnapshot; selectedManifest?: KitManifest; onRefreshLocal?: () => void }) {
  const agentOptions = Array.from(new Set([
    ...(selectedManifest?.supportedAgents ?? []),
    ...snapshot.rows.flatMap((row) => row.binding?.agentId ? [row.binding.agentId] : [])
  ].filter(Boolean)));
  const projectOptions = unique(snapshot.rows.flatMap((row) => row.binding?.projectId ? [row.binding.projectId] : []));
  const defaultAgentId = agentOptions[0] ?? '';
  const defaultProjectId = projectOptions[0] ?? '';
  const [importText, setImportText] = useState(selectedManifest ? JSON.stringify(selectedManifest, null, 2) : '');
  const [sourcePath, setSourcePath] = useState('');
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [agentKitId, setAgentKitId] = useState(defaultAgentId ? `kit.${defaultAgentId}` : '');
  const [agentKitName, setAgentKitName] = useState(defaultAgentId ? `${defaultAgentId} Kit` : '');
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [projectKitId, setProjectKitId] = useState(defaultProjectId ? `kit.${defaultProjectId}` : '');
  const [projectKitName, setProjectKitName] = useState(defaultProjectId ? `${defaultProjectId} Kit` : '');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedManifest) setImportText(JSON.stringify(selectedManifest, null, 2));
  }, [selectedManifest]);

  const run = async (action: () => Promise<unknown>, successText: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await action();
      setMessage(phase3OperationMessage(result, successText));
      onRefreshLocal?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kit 操作失败' });
    } finally {
      setBusy(false);
    }
  };

  const importManifest = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? `KitManifest JSON 无效：${error.message}` : 'KitManifest JSON 无效' });
      return;
    }
    await run(() => desktopApi.kit.importManifest({ manifest: parsed, sourcePath: sourcePath.trim() || undefined }), 'KitManifest 已导入本地资源图。');
  };

  return (
    <section className="panel" data-testid="kit-workbench">
      <h3>Kit 生成与导入</h3>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <label>
          <span className="filter-label">KitManifest JSON</span>
          <textarea className="textarea" aria-label="KitManifest JSON" value={importText} onChange={(event) => setImportText(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">来源路径</span>
          <input className="input" value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} />
        </label>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <label>
          <span className="filter-label">智能体</span>
          <select className="input" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">未选择</option>
            {agentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span className="filter-label">智能体 Kit ID</span>
          <input className="input" value={agentKitId} onChange={(event) => setAgentKitId(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">智能体 Kit 名称</span>
          <input className="input" value={agentKitName} onChange={(event) => setAgentKitName(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">项目</span>
          <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">未选择</option>
            {projectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span className="filter-label">项目 Kit ID</span>
          <input className="input" value={projectKitId} onChange={(event) => setProjectKitId(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">项目 Kit 名称</span>
          <input className="input" value={projectKitName} onChange={(event) => setProjectKitName(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">版本</span>
          <input className="input" value={version} onChange={(event) => setVersion(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">描述</span>
          <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </div>
      {message ? <p className="muted" role="status" style={messageStyle(message.tone)}>{message.text}</p> : null}
      <div className="card-action-row">
        <Button disabled={busy || !importText.trim()} onClick={importManifest}>导入 Kit</Button>
        <Button
          disabled={busy || !agentId || !agentKitId.trim() || !agentKitName.trim()}
          onClick={() => run(() => desktopApi.kit.generateFromAgent({
            agentId,
            kitId: agentKitId.trim(),
            name: agentKitName.trim(),
            version: version.trim() || undefined,
            description: description.trim() || undefined
          }), '已从当前智能体生成 KitManifest 并写入本地资源图。')}
        >
          从智能体生成
        </Button>
        <Button
          disabled={busy || !projectId || !projectKitId.trim() || !projectKitName.trim()}
          onClick={() => run(() => desktopApi.kit.generateFromProject({
            projectId,
            kitId: projectKitId.trim(),
            name: projectKitName.trim(),
            version: version.trim() || undefined,
            description: description.trim() || undefined
          }), '已从当前项目生成 KitManifest 并写入本地资源图。')}
        >
          从项目生成
        </Button>
      </div>
    </section>
  );
}

function KitDetail({
  item,
  manifest,
  snapshot,
  onSelectResource
}: {
  item: VisibleItem;
  manifest: KitManifest;
  snapshot: LocalResourceSnapshot;
  onSelectResource: (item: VisibleItem) => void;
}) {
  const kitRows = rowsForKit(snapshot, manifest.kitId);
  const includedRows = rowsForKitResources(snapshot, manifest);
  const events = eventsForKit(snapshot, manifest.kitId);
  const authShrinkRows = includedRows.filter((row) => row.binding?.authStatus === AuthStatuses.AUTH_REVOKED || row.binding?.authStatus === AuthStatuses.SECURITY_DELISTED);
  const hashAnomalies = kitHashAnomalies(manifest, snapshot);
  const applicationRows = kitRows.filter((row) => row.binding?.metadata?.managedByKitId === manifest.kitId || row.resource.type === LocalResourceTypes.KIT && row.binding?.kitId === manifest.kitId);
  const operationResults = events.flatMap((event) => operationResultsFromEvent(event));

  return (
    <div aria-label={`${manifest.name}工具集详情`} data-testid={`kit-detail-${safeId(manifest.kitId)}`} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
      <header className="section-header">
        <div>
          <h2>{manifest.name}</h2>
          <span className="meta">{manifest.kitId} · {manifest.version} · {item.scopeLabel}</span>
        </div>
        <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <table className="table compact-table" data-testid="kit-overview">
          <tbody>
            <tr>
              <td>适用智能体</td>
              <td>{manifest.supportedAgents.length > 0 ? manifest.supportedAgents.join(' / ') : '未限定'}</td>
              <td>适用平台</td>
              <td>{manifest.supportedPlatforms.length > 0 ? manifest.supportedPlatforms.join(' / ') : '未限定'}</td>
            </tr>
            <tr>
              <td>权限汇总</td>
              <td>{manifest.permissionSummary.label || '未声明'}</td>
              <td>审计汇总</td>
              <td>{auditStatusLabel(manifest.auditSummary.status)} · {manifest.auditSummary.findingCount} 项</td>
            </tr>
            <tr>
              <td>应用分布</td>
              <td>{kitApplicationDistribution(applicationRows)}</td>
              <td>漂移状态</td>
              <td>{hashAnomalies.length > 0 ? 'Hash 异常' : includedRows.some((row) => row.binding?.drifted) ? '配置漂移' : '未发现漂移'}</td>
            </tr>
            <tr>
              <td>离线可用操作</td>
              <td colSpan={3}>导入 / 预览 / 静态审计 / 漂移检查 / 应用本机已有授权缓存资源</td>
            </tr>
          </tbody>
        </table>

        <section className="panel">
          <h3>包含资源</h3>
          <table className="table compact-table" data-testid="kit-resources">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>智能体/项目</th>
                <th>权限</th>
                <th>审计</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {manifest.resources.map((ref) => {
                const row = resolveKitResourceRow(snapshot, ref);
                const resolved = row ? rowToItem(row) : undefined;
                return (
                  <tr key={ref.refId}>
                    <td>{resolved ? <button type="button" className="link-button" onClick={() => onSelectResource(resolved)}>{resolved.name}</button> : ref.refId}</td>
                    <td>{localResourceTypeLabel(ref.resourceType)}</td>
                    <td>{resolved?.scopeLabel ?? '未在本机解析'}</td>
                    <td>{resolved?.permissionLabel ?? '未知'}</td>
                    <td>{resolved?.auditLabel ?? auditStatusLabel(AuditStatuses.NOT_AUDITED)}</td>
                    <td><StatusBadge tone={resolved?.status.tone ?? (ref.required ? 'warn' : 'info')}>{resolved?.status.label ?? (ref.required ? '缺失' : '可选缺失')}</StatusBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h3>授权收缩资源</h3>
          {authShrinkRows.length === 0 ? <p className="muted">未发现授权收缩资源。</p> : (
            <VisibleItemsTable items={authShrinkRows.map(rowToItem)} onSelect={onSelectResource} />
          )}
        </section>

        <section className="panel">
          <h3>Hash 异常资源</h3>
          {hashAnomalies.length === 0 ? <p className="muted">manifest Hash 与本地记录一致，或资源未声明 Hash。</p> : (
            <table className="table compact-table" data-testid="kit-hash-anomalies">
              <tbody>
                {hashAnomalies.map((anomaly) => (
                  <tr key={anomaly.ref.refId}>
                    <td>{anomaly.ref.refId}</td>
                    <td>{localResourceTypeLabel(anomaly.ref.resourceType)}</td>
                    <td>{anomaly.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h3>最近事件</h3>
          {events.length === 0 ? <p className="muted">暂无 Kit 事件。</p> : (
            <table className="table compact-table">
              <tbody>
                {events.slice(0, 5).map((event) => (
                  <tr key={event.eventId}>
                    <td>{event.eventType}</td>
                    <td>{event.status}</td>
                    <td>{event.message}</td>
                    <td>{compactDate(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {operationResults.length > 0 ? (
            <>
              <h3>资源变更结果</h3>
              <table className="table compact-table" data-testid="kit-operation-results">
                <tbody>
                  {operationResults.slice(0, 8).map((result, index) => (
                    <tr key={`${result.resourceRefId ?? result.resourceId ?? index}`}>
                      <td>{result.resourceRefId ?? result.resourceId ?? '计划级结果'}</td>
                      <td>{result.status}</td>
                      <td>{result.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>

        <KitActionPanel manifest={manifest} applicationRows={applicationRows} />
      </div>
    </div>
  );
}

function KitActionPanel({ manifest, applicationRows }: { manifest: KitManifest; applicationRows: LocalResourceRow[] }) {
  const applicationIds = unique(applicationRows.flatMap((row) => asText(row.binding?.metadata?.kitApplicationId, '') ? [asText(row.binding?.metadata?.kitApplicationId, '')] : []));
  const [agentId, setAgentId] = useState(manifest.supportedAgents[0] ?? '');
  const [projectId, setProjectId] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [removeId, setRemoveId] = useState(applicationIds[0] ?? '');
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, successText: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await action();
      setMessage(phase3OperationMessage(result, successText));
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kit 操作失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" data-testid="kit-actions">
      <h3>Kit 操作</h3>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label>
          <span className="filter-label">智能体</span>
          <input className="input" value={agentId} onChange={(event) => setAgentId(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">项目</span>
          <input className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">自定义目录</span>
          <input className="input" value={customPath} onChange={(event) => setCustomPath(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">应用 ID</span>
          <input className="input" value={removeId} onChange={(event) => setRemoveId(event.target.value)} />
        </label>
      </div>
      {message ? <p className="muted" role="status" style={messageStyle(message.tone)}>{message.text}</p> : null}
      <div className="card-action-row">
        <Button disabled={busy} onClick={() => run(() => desktopApi.kit.exportManifest({ kitId: manifest.kitId }), 'Kit manifest 数据已导出到操作结果。')}>导出数据</Button>
        <Button disabled={busy} onClick={() => run(() => desktopApi.kit.checkDrift({ kitId: manifest.kitId }), 'Kit 漂移检查已写入本地事件。')}>检查漂移</Button>
        <Button disabled={busy} onClick={() => run(() => desktopApi.kit.staticAudit({ kitId: manifest.kitId }), 'Kit 静态审计已写入本地事件。')}>静态审计</Button>
        <Button
          disabled={busy || (!agentId && !projectId && !customPath)}
          tone="primary"
          onClick={() => run(() => desktopApi.kit.apply({
            kitId: manifest.kitId,
            target: customPath
              ? { scopeType: ResourceScopeTypes.CUSTOM_PATH, scopePath: customPath }
              : agentId && projectId
                ? { scopeType: ResourceScopeTypes.AGENT_PROJECT, agentId, projectId }
                : projectId
                  ? { scopeType: ResourceScopeTypes.PROJECT, projectId }
                  : { scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId }
          }), 'Kit 应用结果已按资源拆分记录。')}
        >
          应用
        </Button>
        <Button disabled={busy || !removeId} onClick={() => run(() => desktopApi.kit.removeApplication({ kitId: manifest.kitId, applicationId: removeId }), 'Kit 托管应用已移除。')}>移除应用</Button>
      </div>
    </section>
  );
}

function CustomAgentProfileEditor({
  configured,
  agent,
  definition,
  profile,
  settingsConfig,
  onCancel,
  onRefreshLocal
}: {
  configured: boolean;
  agent: VisibleItem;
  definition?: AgentDefinition;
  profile?: Record<string, unknown>;
  settingsConfig: Record<string, unknown>;
  onCancel: () => void;
  onRefreshLocal?: () => void;
}) {
  const initialIdentity = customAgentProfileIdentity(agent, definition, settingsConfig.agentProfiles);
  const [profileId, setProfileId] = useState(initialIdentity.profileId);
  const [agentId, setAgentId] = useState(initialIdentity.agentId);
  const [displayName, setDisplayName] = useState(initialIdentity.displayName);
  const [rootPath, setRootPath] = useState(asStringArray(profile?.detectionRoots)[0] ?? '');
  const [rulesText, setRulesText] = useState(JSON.stringify(profile?.resourcePaths ?? {}, null, 2));
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const identity = customAgentProfileIdentity(agent, definition, settingsConfig.agentProfiles);
    setProfileId(identity.profileId);
    setAgentId(identity.agentId);
    setDisplayName(identity.displayName);
    setRootPath(asStringArray(profile?.detectionRoots)[0] ?? '');
    setRulesText(JSON.stringify(profile?.resourcePaths ?? {}, null, 2));
  }, [agent.id, definition?.id, profile, settingsConfig.agentProfiles]);
  const validate = () => buildCustomAgentProfile({ profileId, agentId, displayName, rootPath, rulesText });
  const handleValidate = () => {
    const result = validate();
    setMessage(result.valid ? { tone: 'success', text: 'Path Profile 静态校验通过；保存后将按内置智能体同一模型扫描。' } : { tone: 'error', text: result.error });
  };
  const handleSave = async () => {
    const result = validate();
    if (!result.valid) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    setSaving(true);
    setMessage(undefined);
    try {
      await desktopApi.settings.save({ ...settingsConfig, agentProfiles: upsertAgentProfile(settingsConfig.agentProfiles, result.profile) });
      setMessage({ tone: 'success', text: 'Agent Profile 已保存；正在重新扫描本地资源。' });
      onRefreshLocal?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Agent Profile 保存失败' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="grid" data-testid="custom-agent-profile-form" onSubmit={(event) => event.preventDefault()}>
      <h3>Agent Profile 配置</h3>
      <p className="muted">{configured ? '已检测到自定义目录资源，行为按内置智能体同一模型展示。' : '未配置路径规则；请配置根目录和资源路径后再纳入扫描。'}</p>
      <label>
        <span className="filter-label">Profile ID</span>
        <input className="input" aria-label="Profile ID" value={profileId} onChange={(event) => setProfileId(event.target.value)} />
      </label>
      <label>
        <span className="filter-label">Agent ID</span>
        <input className="input" aria-label="Agent ID" value={agentId} onChange={(event) => setAgentId(event.target.value)} />
      </label>
      <label>
        <span className="filter-label">显示名称</span>
        <input className="input" aria-label="显示名称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label>
        <span className="filter-label">根目录</span>
        <input className="input" aria-label="根目录" value={rootPath} onChange={(event) => {
          const nextRoot = event.target.value;
          setRootPath(nextRoot);
          if (!rulesText.trim() || rulesText.trim() === '{}') setRulesText(JSON.stringify(defaultCustomResourcePaths(nextRoot), null, 2));
        }} />
      </label>
      <label>
        <span className="filter-label">Path Profile 规则</span>
        <textarea className="textarea" aria-label="Path Profile 规则" value={rulesText} onChange={(event) => setRulesText(event.target.value)} />
      </label>
      {message ? <p className="muted" style={messageStyle(message.tone)} role="status">{message.text}</p> : null}
      <div className="card-action-row">
        <Button onClick={onCancel}>取消</Button>
        <Button onClick={handleValidate}>验证 Path Profile</Button>
        <Button tone="primary" disabled={saving} onClick={handleSave}>{saving ? '保存中' : '保存 Agent Profile'}</Button>
      </div>
    </form>
  );
}

export function LocalResourceDrawer({ item, snapshot, onSelectResource, onRefreshLocal, onClose }: { item: VisibleItem; snapshot: LocalResourceSnapshot; onSelectResource?: (item: VisibleItem) => void; onRefreshLocal?: () => void; onClose: () => void }) {
  const row = item.row;
  const resource = row?.resource;
  const binding = row?.binding;
  const relatedRows = resource ? snapshot.rows.filter((candidate) => candidate.resource.id === resource.id) : row ? [row] : [];
  const selectedFile = fileForItem(item);
  const eventRow = item.event ? rowForEvent(snapshot, item.event) : undefined;
  const [pathCheck, setPathCheck] = useState<{ busy: boolean; tone: 'success' | 'error' | 'info'; text?: string }>({ busy: false, tone: 'info' });
  const [filePreview, setFilePreview] = useState<{ busy: boolean; tone: UiMessageTone; text?: string; content?: string }>({ busy: false, tone: 'info' });
  const canCheckPath = Boolean(binding?.id ?? resource?.id ?? item.path);
  const canPreviewFile = Boolean(selectedFile && (binding?.id ?? resource?.id ?? item.path));
  const checkPath = async () => {
    if (!canCheckPath) return;
    setPathCheck({ busy: true, tone: 'info', text: '正在检查真实路径状态。' });
    try {
      const result = await desktopApi.local.checkPath({
        bindingId: binding?.id,
        resourceId: binding?.id ? undefined : resource?.id,
        targetPath: binding?.id || resource?.id ? undefined : item.path
      }) as { pathStatus: string; message: string; drifted?: boolean };
      setPathCheck({
        busy: false,
        tone: result.pathStatus === PathStatuses.OK ? 'success' : 'error',
        text: `${result.message}${result.drifted ? ' 检测到 Hash 漂移。' : ''}`
      });
      onRefreshLocal?.();
    } catch (error) {
      setPathCheck({ busy: false, tone: 'error', text: error instanceof Error ? error.message : '路径检查失败' });
    }
  };
  const previewFile = async () => {
    if (!canPreviewFile) return;
    setFilePreview({ busy: true, tone: 'info', text: '正在读取本地文件预览。' });
    try {
      const result = await desktopApi.local.previewFile({
        bindingId: binding?.id,
        resourceId: binding?.id ? undefined : resource?.id,
        targetPath: binding?.id || resource?.id ? undefined : item.path
      }) as { previewAvailable: boolean; redactedContent?: string; failureReason?: string; suggestion?: string; contentType?: string; size?: number };
      setFilePreview(result.previewAvailable
        ? {
          busy: false,
          tone: 'success',
          text: `文件预览已脱敏：${result.contentType ?? 'text'} / ${result.size ?? 0} bytes。`,
          content: result.redactedContent ?? ''
        }
        : {
          busy: false,
          tone: 'error',
          text: `${result.failureReason ?? '文件预览不可用'}${result.suggestion ? ` ${result.suggestion}` : ''}`
        });
      onRefreshLocal?.();
    } catch (error) {
      setFilePreview({ busy: false, tone: 'error', text: error instanceof Error ? error.message : '文件预览失败' });
    }
  };
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
              {relatedRows.slice(0, 6).map((candidate) => {
                const candidateItem = rowToItem(candidate);
                return (
                  <tr key={candidate.binding?.id ?? candidate.resource.id}>
                    <td>{candidate.scopeLabel}</td>
                    <td>{candidate.binding?.agentId ?? candidate.binding?.projectId ?? candidate.binding?.kitId ?? '未绑定'}</td>
                    <td>{candidate.status.label}</td>
                    <td>{candidate.binding?.targetPath ?? candidate.resource.sourcePath ?? '未知'}</td>
                    <td><Button tone="ghost" onClick={() => onSelectResource?.(candidateItem)}>打开绑定</Button></td>
                  </tr>
                );
              })}
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
      <FilePreviewSection
        file={selectedFile}
        preview={filePreview}
        canPreview={canPreviewFile}
        onPreview={previewFile}
      />
      {item.finding ? <AuditFindingDetailSection finding={item.finding} row={row} events={eventsForFinding(snapshot, item.finding)} onOpenResource={row ? () => onSelectResource?.(rowToItem(row)) : undefined} /> : null}
      {item.event ? <LocalEventDetailSection event={item.event} row={eventRow} onOpenResource={eventRow ? () => onSelectResource?.(rowToItem(eventRow)) : undefined} /> : null}
      {resource && isExtensionResource(resource.type) ? <ExtensionDetailSections item={item} rows={relatedRows} events={row?.events ?? []} /> : null}
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
        <p className="muted">当前提供真实扫描、预览、权限摘要、静态审计和配置事件展示；写入需要 ExecutionPlan、备份和回滚链路，Hook / CLI / MCP stdio 或 command 均不会被启动。</p>
        <div className="card-action-row">
          <Button disabled title="需要 ExecutionPlan、备份和回滚接入">启用</Button>
          <Button disabled title="需要 ExecutionPlan、备份和回滚接入">停用</Button>
          <Button disabled={filePreview.busy || !canPreviewFile} title={selectedFile ? '真实读取小型文本文件并脱敏展示' : '没有可预览文件'} onClick={previewFile}>预览文件</Button>
          <Button disabled={pathCheck.busy || !canCheckPath} title={canCheckPath ? '真实读取路径状态并写入本地事件' : '没有可检查路径'} onClick={checkPath}>检查路径</Button>
        </div>
        {pathCheck.text ? <p className={pathCheck.tone === 'error' ? 'error-text' : pathCheck.tone === 'success' ? 'success-text' : 'muted'}>{pathCheck.text}</p> : null}
      </section>
      {resource?.metadata ? <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(redactForLog(resource.metadata), null, 2)}</pre> : null}
    </Drawer>
  );
}

export function FilePreviewSection({
  file,
  preview,
  canPreview,
  onPreview
}: {
  file?: FileBackedResource;
  preview: { busy: boolean; tone: UiMessageTone; text?: string; content?: string };
  canPreview: boolean;
  onPreview: () => void;
}) {
  return (
    <section className="panel" data-testid="local-file-preview">
      <h3>文件预览</h3>
      <DetailLine label="预览状态" value={file ? file.previewAvailable ? '可预览' : '不可预览' : '未绑定文件'} />
      <DetailLine label="文件类型" value={file?.contentType} />
      <DetailLine label="文件大小" value={file?.size === undefined ? undefined : `${file.size} bytes`} />
      {!file ? <p className="muted">当前资源没有 FileBackedResource 记录；可先运行路径检查或重新扫描。</p> : null}
      {file && !file.previewAvailable ? <p className="muted">该文件仅显示路径、Hash 和审计信息；预览失败原因可通过真实预览请求返回。</p> : null}
      <div className="card-action-row">
        <Button disabled={preview.busy || !canPreview} onClick={onPreview}>{preview.busy ? '预览中' : '读取脱敏预览'}</Button>
      </div>
      {preview.text ? <p className="muted" style={messageStyle(preview.tone)} role="status">{preview.text}</p> : null}
      {preview.content !== undefined ? <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.content}</pre> : null}
    </section>
  );
}

export function AuditFindingDetailSection({ finding, row, events, onOpenResource }: { finding: AuditFindingRecord; row?: LocalResourceRow; events: LocalEventRecord[]; onOpenResource?: () => void }) {
  const definition = auditRuleDefinition(finding.ruleId);
  const trustScore = row?.resource.auditSummary.trustScore ?? Math.max(0, 100 - finding.trustScoreImpact);
  return (
    <section className="panel" data-testid={`audit-finding-detail-${safeId(finding.id)}`}>
      <h3>审计详情</h3>
      <DetailLine label="风险等级" value={`${finding.severity}${finding.blocker ? ' / 阻断' : ''}`} />
      <DetailLine label="Trust Score" value={trustScore} />
      <DetailLine label="规则编号" value={`${finding.ruleId}${finding.harnessRuleId ? ` / HarnessKit ${finding.harnessRuleId}` : ''}`} />
      <DetailLine label="权限维度" value={finding.permissionCategory} />
      <DetailLine label="风险说明" value={finding.description || definition?.description} />
      <DetailLine label="影响范围" value={formatImpactScope(finding.impactScope)} />
      <DetailLine label="建议处理" value={finding.remediation || definition?.remediation} />
      <DetailLine label="资源定位" value={formatFindingLocation(finding)} />
      <DetailLine label="代码片段" value={finding.snippetHash ? `hash ${finding.snippetHash}` : '未保留明文片段'} />
      {onOpenResource ? <div className="card-action-row"><Button onClick={onOpenResource}>打开关联资源</Button></div> : null}
      {events.length === 0 ? <p className="muted">暂无关联事件。</p> : (
        <table className="table compact-table">
          <tbody>
            {events.slice(0, 6).map((event) => (
              <tr key={event.eventId}>
                <td>{event.eventType}</td>
                <td>{event.status}</td>
                <td>{event.message}</td>
                <td>{compactDate(event.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function LocalEventDetailSection({ event, row, onOpenResource }: { event: LocalEventRecord; row?: LocalResourceRow; onOpenResource?: () => void }) {
  return (
    <section className="panel" data-testid={`local-event-detail-${safeId(event.eventId)}`}>
      <h3>事件详情</h3>
      <DetailLine label="事件类型" value={event.eventType} />
      <DetailLine label="操作状态" value={event.status} />
      <DetailLine label="同步状态" value={event.syncStatus} />
      <DetailLine label="离线生成" value={event.offlineCreated ? '是' : '否'} />
      <DetailLine label="服务端回执" value={event.serverAckStatus} />
      <DetailLine label="资源" value={event.resourceId} />
      <DetailLine label="绑定" value={event.bindingId} />
      <DetailLine label="智能体" value={event.agentId} />
      <DetailLine label="项目" value={event.projectId} />
      <DetailLine label="工具集" value={event.kitId} />
      <DetailLine label="失败原因" value={event.failureReason} />
      <DetailLine label="建议动作" value={event.suggestion} />
      <DetailLine label="反查资源" value={row ? `${row.resource.displayName || row.resource.name} / ${localResourceTypeLabel(row.resource.type)}` : '未找到关联资源'} />
      <DetailLine label="反查路径" value={row?.binding?.targetPath ?? row?.resource.sourcePath} />
      <DetailLine label="反查作用域" value={row?.scopeLabel} />
      {onOpenResource ? <div className="card-action-row"><Button onClick={onOpenResource}>打开关联资源</Button></div> : null}
    </section>
  );
}

function ExtensionDetailSections({ item, rows, events }: { item: VisibleItem; rows: LocalResourceRow[]; events: LocalEventRecord[] }) {
  const resource = item.row?.resource;
  const metadata = resource?.metadata ?? {};
  const agentIds = unique(rows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
  const projectIds = unique(rows.map((row) => row.binding?.projectId).filter((value): value is string => Boolean(value)));
  const authShrink = rows.some((row) => row.binding?.authStatus === AuthStatuses.AUTH_REVOKED || row.binding?.authStatus === AuthStatuses.SECURITY_DELISTED);
  const configEvents = events.filter((event) => !event.eventType.includes('TRIGGER') && !event.eventType.includes('EXECUT') && !event.eventType.includes('CALL'));
  return (
    <>
      <section className="panel">
        <h3>扩展分布</h3>
        <DetailLine label="跨智能体分布" value={agentIds.length > 0 ? `${agentIds.length} 个：${agentIds.join(' / ')}` : '未绑定智能体'} />
        <DetailLine label="跨项目分布" value={projectIds.length > 0 ? `${projectIds.length} 个：${projectIds.join(' / ')}` : '未绑定项目'} />
        <DetailLine label="授权状态" value={authShrink ? '授权收缩' : rows[0]?.binding?.authStatus} />
        {authShrink ? <p className="muted">授权收缩后禁止新增安装、接入、下载、复制配置、启用、连接检测、更新或应用包含该资源的新 Kit 变更；清理和静态审计仍可用。</p> : null}
      </section>
      {resource?.type === LocalResourceTypes.MCP_SERVER ? (
        <section className="panel">
          <h3>MCP 托管配置</h3>
          <DetailLine label="托管配置块" value={asText(metadata.managedConfigId ?? metadata.fullConfigRef, '未记录')} />
          <DetailLine label="SecureStore 引用" value={formatSecretRefs(metadata.secretRefs ?? metadata.secureRef ?? metadata.fullConfigRef)} />
          <DetailLine label="敏感变量" value={formatSensitiveVariables(metadata.variablesSchema)} />
          <p className="muted">stdio / command 类型只做静态配置检查，不启动本地进程。</p>
        </section>
      ) : null}
      {resource?.type === LocalResourceTypes.PLUGIN ? (
        <section className="panel">
          <h3>Plugin 安装模式</h3>
          <DetailLine label="记录模式" value={pluginModeLabel(metadata.installMode)} />
          <DetailLine label="适配器" value={metadata.adapterId} />
          <DetailLine label="受控下载包" value={metadata.downloadedPackagePath ? '已记录' : '未记录'} />
        </section>
      ) : null}
      {isHookOrCliResource(resource?.type) ? (
        <section className="panel">
          <h3>配置事件</h3>
          <p className="muted">Hook 和 CLI 在阶段三只进入配置管理、路径检查、权限摘要、静态审计和配置事件体系，不展示运行时触发或调用记录。</p>
          {configEvents.length === 0 ? <p className="muted">暂无配置事件。</p> : (
            <table className="table compact-table">
              <tbody>
                {configEvents.slice(0, 5).map((event) => (
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
      ) : null}
    </>
  );
}

function DetailLine({ label, value }: { label: string; value?: unknown }) {
  return (
    <p>
      <strong>{label}：</strong>{asText(value, '未知')}
    </p>
  );
}

function formatFindingLocation(finding: AuditFindingRecord): string {
  const lineRange = finding.lineStart
    ? `:${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ''}`
    : '';
  return [
    `resourceId=${finding.resourceId}`,
    finding.bindingId ? `bindingId=${finding.bindingId}` : undefined,
    finding.agentId ? `agentId=${finding.agentId}` : undefined,
    finding.projectId ? `projectId=${finding.projectId}` : undefined,
    finding.kitId ? `kitId=${finding.kitId}` : undefined,
    finding.pathSummary || finding.path ? `path=${finding.pathSummary ?? finding.path}${lineRange}` : undefined
  ].filter(Boolean).join(' / ');
}

function formatImpactScope(scope: Record<string, unknown>): string {
  const redacted = redactForLog(scope);
  if (!redacted || typeof redacted !== 'object' || Array.isArray(redacted)) return asText(redacted, '未知');
  const entries = Object.entries(redacted as Record<string, unknown>).slice(0, 8);
  if (entries.length === 0) return '未声明';
  return entries.map(([key, value]) => `${key}=${asText(value, '未知')}`).join(' / ');
}

function createVisibleItems(snapshot: LocalResourceSnapshot, nav: typeof NAV_ITEMS[number]): VisibleItem[] {
  const resourceItems = (snapshot.rows ?? [])
    .filter((row) => !nav.resourceTypes || nav.resourceTypes.includes(row.resource.type))
    .map(rowToItem);
  const findingItems = nav.includeEvents
    ? (snapshot.findings ?? []).map((finding) => findingToItem(finding, snapshot))
    : [];
  const eventItems = nav.includeEvents
    ? (snapshot.events ?? []).map(eventToItem)
    : [];
  return [...resourceItems, ...findingItems, ...eventItems];
}

function createExtensionItems(snapshot: LocalResourceSnapshot): VisibleItem[] {
  const resources = uniqueResources((snapshot.rows ?? []).filter((row) => isExtensionResource(row.resource.type)));
  return resources.map((resource) => {
    const rows = rowsForResource(snapshot, resource.id);
    const base = rows[0] ?? { resource, binding: undefined, files: [], events: [], status: { key: 'unknown', label: '未知', tone: 'info' as const, source: 'unknown' }, scopeLabel: '未绑定' };
    const item = rowToItem(base);
    const agentIds = unique(rows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
    const projectIds = unique(rows.map((row) => row.binding?.projectId).filter((value): value is string => Boolean(value)));
    return {
      ...item,
      id: `${resource.id}:extension`,
      scopeLabel: distributionLabel(rows),
      status: summarizeRowsStatus(rows),
      agentId: agentIds.length === 1 ? agentIds[0] : undefined,
      agentIds,
      projectId: projectIds.length === 1 ? projectIds[0] : undefined,
      projectIds,
      platforms: extractPlatforms(resource.metadata),
      row: base
    };
  });
}

function createProjectItems(snapshot: LocalResourceSnapshot): VisibleItem[] {
  const projectIds = unique([
    ...(snapshot.rows ?? []).flatMap((row) => row.resource.type === LocalResourceTypes.PROJECT && row.resource.sourceId ? [row.resource.sourceId] : []),
    ...(snapshot.bindings ?? []).flatMap((binding) => binding.projectId ? [binding.projectId] : [])
  ]);
  return projectIds.map((projectId) => {
    const rows = rowsForProject(snapshot, projectId);
    const projectRow = rows.find((row) => row.resource.type === LocalResourceTypes.PROJECT);
    const base = projectRow ?? rows[0];
    const item = base ? rowToItem(base) : missingProjectItem(projectId);
    const associatedRows = rows.filter((row) => row.resource.type !== LocalResourceTypes.PROJECT);
    const agents = unique(associatedRows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
    return {
      ...item,
      id: `${projectId}:project`,
      name: projectRow?.resource.displayName ?? projectRow?.resource.name ?? projectId,
      typeLabel: localResourceTypeLabel(LocalResourceTypes.PROJECT),
      type: LocalResourceTypes.PROJECT,
      scopeLabel: `${agents.length || 0} 智能体 / ${associatedRows.length} 资源`,
      permissionLabel: associatedRows.length > 0 ? summarizePermissions(associatedRows) : item.permissionLabel,
      permissionCategories: Array.from(new Set(associatedRows.flatMap((row) => row.resource.permissionSummary.categories))),
      auditLabel: associatedRows.length > 0 ? summarizeAudit(associatedRows) : item.auditLabel,
      status: summarizeRowsStatus(projectRow ? [projectRow, ...associatedRows] : associatedRows),
      path: projectRow?.binding?.targetPath ?? projectRow?.resource.sourcePath ?? item.path,
      source: projectRow?.resource.sourceType ?? item.source,
      projectId,
      projectIds: [projectId],
      agentIds: agents,
      row: projectRow ?? base
    };
  });
}

function createKitItems(snapshot: LocalResourceSnapshot): VisibleItem[] {
  return (snapshot.resources ?? [])
    .filter((resource) => resource.type === LocalResourceTypes.KIT && extractKitManifest(resource.metadata))
    .map((resource) => {
      const manifest = extractKitManifest(resource.metadata) as KitManifest;
      const ownRows = rowsForResource(snapshot, resource.id);
      const base = ownRows[0] ?? {
        resource,
        binding: undefined,
        files: [],
        events: [],
        status: { key: 'kit_unapplied', label: '未应用', tone: 'info' as const, source: 'kitManifest' },
        scopeLabel: '未应用'
      };
      const item = rowToItem(base);
      const kitRows = rowsForKit(snapshot, manifest.kitId);
      const includedRows = rowsForKitResources(snapshot, manifest);
      const applicationRows = kitRows.filter((row) => row.binding?.metadata?.managedByKitId === manifest.kitId || row.resource.type === LocalResourceTypes.KIT && row.binding?.kitId === manifest.kitId);
      const hashAnomalies = kitHashAnomalies(manifest, snapshot);
      const authShrink = includedRows.some((row) => row.binding?.authStatus === AuthStatuses.AUTH_REVOKED || row.binding?.authStatus === AuthStatuses.SECURITY_DELISTED);
      const status = authShrink
        ? { key: 'kit_auth_shrink', label: '授权收缩', tone: 'warn' as const, source: 'kitResources' }
        : hashAnomalies.length > 0
          ? { key: 'kit_hash_anomaly', label: 'Hash 异常', tone: 'warn' as const, source: 'kitManifest' }
          : applicationRows.length === 0
            ? { key: 'kit_unapplied', label: '未应用', tone: 'info' as const, source: 'kitManifest' }
            : summarizeRowsStatus(applicationRows);
      const agents = unique(applicationRows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
      const projects = unique(applicationRows.map((row) => row.binding?.projectId).filter((value): value is string => Boolean(value)));
      return {
        ...item,
        id: `${resource.id}:kit`,
        name: manifest.name,
        typeLabel: localResourceTypeLabel(LocalResourceTypes.KIT),
        type: LocalResourceTypes.KIT,
        scopeLabel: applicationRows.length > 0 ? distributionLabel(applicationRows) : '未应用',
        permissionLabel: manifest.permissionSummary.label || '未声明',
        permissionCategories: manifest.permissionSummary.categories,
        auditLabel: auditStatusLabel(manifest.auditSummary.status),
        auditStatus: manifest.auditSummary.status,
        status,
        version: manifest.version,
        source: `${resource.sourceType}/${manifest.sourceType}`,
        agentId: agents.length === 1 ? agents[0] : undefined,
        agentIds: agents,
        projectId: projects.length === 1 ? projects[0] : undefined,
        projectIds: projects,
        kitId: manifest.kitId,
        platforms: manifest.supportedPlatforms,
        row: base
      };
    });
}

function createAgentItems(snapshot: LocalResourceSnapshot): VisibleItem[] {
  const staticAgentIds = new Set<string>(AGENT_DEFINITIONS.map((definition) => definition.id));
  const dynamicDefinitions: AgentDefinition[] = unique((snapshot.rows ?? []).flatMap((row) => {
    if (row.resource.type !== LocalResourceTypes.AGENT) return [];
    const agentId = row.binding?.agentId ?? row.resource.sourceId;
    if (!agentId || staticAgentIds.has(agentId)) return [];
    return [agentId];
  })).map((agentId) => {
    const row = snapshot.rows.find((item) => item.resource.type === LocalResourceTypes.AGENT && (item.binding?.agentId === agentId || item.resource.sourceId === agentId));
    return {
      id: agentId,
      label: row?.resource.displayName || row?.resource.name || agentId,
      builtIn: false
    };
  });
  return ([...AGENT_DEFINITIONS, ...dynamicDefinitions] as AgentDefinition[]).map((definition) => {
    const agentRow = snapshot.rows.find((row) => row.resource.type === LocalResourceTypes.AGENT && (row.resource.sourceId === definition.id || row.binding?.agentId === definition.id));
    const relatedRows = rowsForAgent(snapshot, definition.id);
    const agentStatus = agentRow?.status ?? summarizeAgentStatus(definition, relatedRows);
    const path = agentRow?.binding?.targetPath ?? asText(asRecord(agentRow?.resource.metadata.pathProfile)?.fallbackRoot, undefined);
    return {
      id: `agent:${definition.id}`,
      name: agentRow?.resource.displayName || definition.label,
      typeLabel: localResourceTypeLabel(LocalResourceTypes.AGENT),
      type: LocalResourceTypes.AGENT,
      scopeLabel: definition.builtIn ? `${definition.label} / 智能体全局` : `${definition.label} / 自定义路径`,
      permissionLabel: relatedRows.length > 0 ? summarizePermissions(relatedRows) : '未声明',
      permissionCategories: Array.from(new Set(relatedRows.flatMap((row) => row.resource.permissionSummary.categories))),
      auditLabel: relatedRows.length > 0 ? summarizeAudit(relatedRows) : auditStatusLabel(AuditStatuses.NOT_AUDITED),
      auditStatus: agentRow?.resource.auditSummary.status ?? AuditStatuses.NOT_AUDITED,
      status: agentStatus,
      path,
      updatedAt: agentRow?.binding?.updatedAt ?? agentRow?.resource.lastScannedAt ?? agentRow?.resource.createdAt,
      source: definition.builtIn ? '内置 Path Profile' : '自定义 Agent Profile',
      row: agentRow,
      agentId: definition.id,
      builtIn: definition.builtIn
    };
  });
}

function rowsForResource(snapshot: LocalResourceSnapshot, resourceId: string): LocalResourceRow[] {
  return (snapshot.rows ?? []).filter((row) => row.resource.id === resourceId);
}

function summarizeAgentStatus(definition: AgentDefinition, rows: LocalResourceRow[]): AggregatedResourceStatus {
  if (!definition.builtIn && rows.length === 0) return { key: 'not_configured', label: '未配置', tone: 'info', source: 'customProfile' };
  if (rows.length === 0) return { key: 'not_detected', label: '未检测', tone: 'info', source: 'pathProfile' };
  if (rows.some((row) => row.status.tone === 'danger')) return rows.find((row) => row.status.tone === 'danger')?.status ?? rows[0].status;
  if (rows.some((row) => row.status.tone === 'warn')) return rows.find((row) => row.status.tone === 'warn')?.status ?? rows[0].status;
  return rows[0].status;
}

function rowsForAgent(snapshot: LocalResourceSnapshot, agentId: string): LocalResourceRow[] {
  return (snapshot.rows ?? []).filter((row) => row.binding?.agentId === agentId || row.resource.sourceId === agentId || String(row.resource.sourceId ?? '').startsWith(`${agentId}:`));
}

function eventsForAgent(snapshot: LocalResourceSnapshot, agentId: string): LocalEventRecord[] {
  return (snapshot.events ?? []).filter((event) => event.agentId === agentId || String(event.resourceId ?? '').includes(agentId) || String(event.metadata?.agentId ?? '') === agentId);
}

function rowsForProject(snapshot: LocalResourceSnapshot, projectId: string): LocalResourceRow[] {
  return (snapshot.rows ?? []).filter((row) => row.binding?.projectId === projectId || (row.resource.type === LocalResourceTypes.PROJECT && row.resource.sourceId === projectId));
}

function eventsForProject(snapshot: LocalResourceSnapshot, projectId: string): LocalEventRecord[] {
  return (snapshot.events ?? []).filter((event) => event.projectId === projectId || String(event.metadata?.projectId ?? '') === projectId);
}

function rowsForKit(snapshot: LocalResourceSnapshot, kitId: string): LocalResourceRow[] {
  return (snapshot.rows ?? []).filter((row) => (
    row.binding?.kitId === kitId
    || row.resource.sourceId === kitId
    || extractKitManifest(row.resource.metadata)?.kitId === kitId
    || row.binding?.metadata?.managedByKitId === kitId
  ));
}

function rowsForKitResources(snapshot: LocalResourceSnapshot, manifest: KitManifest): LocalResourceRow[] {
  return manifest.resources.flatMap((ref) => {
    const row = resolveKitResourceRow(snapshot, ref);
    return row ? [row] : [];
  });
}

function eventsForKit(snapshot: LocalResourceSnapshot, kitId: string): LocalEventRecord[] {
  const kitResourceIds = new Set((snapshot.resources ?? [])
    .filter((resource) => resource.type === LocalResourceTypes.KIT && (resource.sourceId === kitId || extractKitManifest(resource.metadata)?.kitId === kitId))
    .map((resource) => resource.id));
  return (snapshot.events ?? []).filter((event) => (
    event.kitId === kitId
    || (event.resourceId ? kitResourceIds.has(event.resourceId) : false)
    || String(event.metadata?.kitId ?? '') === kitId
    || asRecord(event.metadata?.operationResult)?.kitId === kitId
  ));
}

function rowForFinding(snapshot: LocalResourceSnapshot, finding: AuditFindingRecord): LocalResourceRow | undefined {
  return (snapshot.rows ?? []).find((row) => (
    row.resource.id === finding.resourceId
    && (!finding.bindingId || row.binding?.id === finding.bindingId)
  )) ?? (snapshot.rows ?? []).find((row) => row.resource.id === finding.resourceId);
}

function eventsForFinding(snapshot: LocalResourceSnapshot, finding: AuditFindingRecord): LocalEventRecord[] {
  const relatedIds = new Set(finding.relatedEventIds);
  return (snapshot.events ?? []).filter((event) => (
    relatedIds.has(event.eventId)
    || relatedIds.has(event.idempotencyKey)
    || event.resourceId === finding.resourceId
    || Boolean(finding.bindingId && event.bindingId === finding.bindingId)
    || Boolean(finding.agentId && event.agentId === finding.agentId)
    || Boolean(finding.projectId && event.projectId === finding.projectId)
    || Boolean(finding.kitId && event.kitId === finding.kitId)
  ));
}

export function rowForEvent(snapshot: LocalResourceSnapshot, event: LocalEventRecord): LocalResourceRow | undefined {
  const rows = snapshot.rows ?? [];
  const hasScope = Boolean(event.agentId || event.projectId || event.kitId);
  const scopedMatch = (row: LocalResourceRow) => {
    if (!hasScope) return false;
    return (!event.agentId || row.binding?.agentId === event.agentId)
      && (!event.projectId || row.binding?.projectId === event.projectId)
      && (!event.kitId || row.binding?.kitId === event.kitId);
  };
  const bindingMatch = event.bindingId ? rows.find((row) => row.binding?.id === event.bindingId) : undefined;
  if (bindingMatch) return bindingMatch;
  const scopedResourceMatch = event.resourceId ? rows.find((row) => row.resource.id === event.resourceId && (!hasScope || scopedMatch(row))) : undefined;
  if (scopedResourceMatch) return scopedResourceMatch;
  const resourceMatch = event.resourceId ? rows.find((row) => row.resource.id === event.resourceId) : undefined;
  return resourceMatch ?? rows.find(scopedMatch);
}

function fileForItem(item: VisibleItem): FileBackedResource | undefined {
  if (!item.row) return undefined;
  if (item.path) {
    const exact = item.row.files.find((file) => file.path === item.path);
    if (exact) return exact;
  }
  return item.row.files[0];
}

function definitionForAgent(agentId: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((definition) => definition.id === agentId);
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
    row,
    agentId: binding?.agentId,
    agentIds: binding?.agentId ? [binding.agentId] : [],
    projectId: binding?.projectId,
    projectIds: binding?.projectId ? [binding.projectId] : [],
    kitId: binding?.kitId,
    platforms: extractPlatforms(resource.metadata)
  };
}

function fileToItem(file: FileBackedResource, row: LocalResourceRow): VisibleItem {
  return {
    ...rowToItem(row),
    id: `file:${file.bindingId}:${file.path}`,
    name: file.path.split(/[\\/]/).pop() || file.path,
    typeLabel: '文件',
    path: file.path,
    hash: file.currentHash ?? file.lastKnownHash,
    updatedAt: file.lastKnownMtime,
    source: file.contentType
  };
}

function eventToItem(event: LocalEventRecord): VisibleItem {
  const status = eventStatus(event);
  return {
    id: event.eventId,
    name: event.message,
    typeLabel: localResourceTypeLabel(event.resourceType ?? LocalResourceTypes.LOCAL_EVENT),
    type: 'EVENT',
    scopeLabel: [event.agentId, event.projectId, event.kitId].filter(Boolean).join(' / ') || '本地事件',
    permissionLabel: '不适用',
    permissionCategories: [],
    auditLabel: auditStatusLabel(AuditStatuses.NOT_AUDITED),
    auditStatus: AuditStatuses.NOT_AUDITED,
    status,
    updatedAt: event.createdAt,
    source: event.eventType,
    event,
    agentId: event.agentId,
    agentIds: event.agentId ? [event.agentId] : [],
    projectId: event.projectId,
    projectIds: event.projectId ? [event.projectId] : [],
    kitId: event.kitId,
    kitIds: event.kitId ? [event.kitId] : [],
    syncStatus: event.syncStatus,
    offlineCreated: event.offlineCreated,
    createdAt: event.createdAt,
    eventType: event.eventType
  };
}

function eventStatus(event: LocalEventRecord): AggregatedResourceStatus {
  if (event.status === 'rollback_failed') return { key: 'event_rollback_failed', label: '回滚失败', tone: 'danger', source: 'event' };
  if (event.syncStatus === SyncStatuses.SERVER_REJECTED || event.status === 'failure') return { key: 'event_failure', label: '失败', tone: 'danger', source: 'event' };
  if (event.status === 'partial_success') return { key: 'event_partial_success', label: '部分成功', tone: 'warn', source: 'event' };
  if (event.status === 'rolled_back') return { key: 'event_rolled_back', label: '回滚成功', tone: 'info', source: 'event' };
  if (event.syncStatus === SyncStatuses.PENDING_SYNC) return { key: 'event_pending', label: '待同步', tone: 'info', source: 'event' };
  if (event.syncStatus === SyncStatuses.SYNC_FAILED) return { key: 'event_sync_failed', label: '同步失败', tone: 'warn', source: 'event' };
  return { key: 'event_info', label: event.status === 'success' ? '成功' : '事件', tone: event.status === 'success' ? 'ok' : 'info', source: 'event' };
}

function findingToItem(finding: AuditFindingRecord, snapshot: LocalResourceSnapshot): VisibleItem {
  const row = rowForFinding(snapshot, finding);
  const relatedEvents = eventsForFinding(snapshot, finding);
  const trustScore = row?.resource.auditSummary.trustScore ?? Math.max(0, 100 - finding.trustScoreImpact);
  return {
    id: finding.id,
    name: finding.title,
    typeLabel: localResourceTypeLabel(finding.resourceType),
    type: 'FINDING',
    scopeLabel: [finding.agentId, finding.projectId, finding.kitId].filter(Boolean).join(' / ') || row?.scopeLabel || '未绑定',
    permissionLabel: finding.permissionCategory,
    permissionCategories: [finding.permissionCategory],
    auditLabel: `${auditStatusLabel(finding.auditStatus)} / Trust ${trustScore}`,
    auditStatus: finding.auditStatus,
    status: findingStatus(finding),
    path: finding.pathSummary ?? finding.path ?? row?.binding?.targetPath ?? row?.resource.sourcePath,
    hash: finding.snippetHash,
    updatedAt: finding.detectedAt,
    source: finding.ruleId,
    row,
    finding,
    agentId: finding.agentId ?? row?.binding?.agentId,
    agentIds: unique([finding.agentId, row?.binding?.agentId].filter((value): value is string => Boolean(value))),
    projectId: finding.projectId ?? row?.binding?.projectId,
    projectIds: unique([finding.projectId, row?.binding?.projectId].filter((value): value is string => Boolean(value))),
    kitId: finding.kitId ?? row?.binding?.kitId,
    kitIds: unique([finding.kitId, row?.binding?.kitId].filter((value): value is string => Boolean(value))),
    syncStatus: relatedEvents[0]?.syncStatus,
    offlineCreated: relatedEvents.some((event) => event.offlineCreated) ? true : undefined,
    createdAt: finding.detectedAt,
    severity: finding.severity,
    ruleId: finding.ruleId
  };
}

function findingStatus(finding: AuditFindingRecord): AggregatedResourceStatus {
  if (finding.blocker || finding.auditStatus === AuditStatuses.SECURITY_RISK) return { key: 'finding_blocker', label: '阻断风险', tone: 'danger', source: 'auditFinding' };
  if (finding.auditStatus === AuditStatuses.HIGH_RISK || finding.severity === 'critical' || finding.severity === 'high') return { key: 'finding_high', label: '高风险', tone: 'danger', source: 'auditFinding' };
  if (finding.auditStatus === AuditStatuses.NEEDS_REVIEW || finding.severity === 'medium') return { key: 'finding_review', label: '需复核', tone: 'warn', source: 'auditFinding' };
  if (finding.auditStatus === AuditStatuses.LOW_RISK || finding.severity === 'low') return { key: 'finding_low', label: '低风险', tone: 'warn', source: 'auditFinding' };
  return { key: 'finding_safe', label: auditStatusLabel(finding.auditStatus), tone: 'info', source: 'auditFinding' };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function messageStyle(tone: UiMessageTone) {
  if (tone === 'error') return { color: 'var(--ea-error-text)' };
  if (tone === 'warn') return { color: 'var(--color-warning)' };
  return undefined;
}

export function staticAuditRunMessage(result: { audited?: number; findingCount?: number; failed?: number }): UiMessage {
  const audited = asNumber(result.audited);
  const findingCount = asNumber(result.findingCount);
  const failed = asNumber(result.failed);
  return failed > 0
    ? { tone: 'error', text: `静态审计完成但存在失败：${audited} 个资源，${findingCount} 项发现，失败 ${failed}。` }
    : { tone: 'success', text: `静态审计完成：${audited} 个资源，${findingCount} 项发现，失败 0。` };
}

export function phase3OperationMessage(result: unknown, successText: string): UiMessage {
  const operation = asPhase3OperationResult(result);
  if (!operation) return { tone: 'success', text: successText };
  const details = [
    phase3StatusLabel(operation.status),
    operation.message || successText,
    resourceResultSummary(operation.resourceResults),
    operation.failureReason ? `原因：${operation.failureReason}` : undefined,
    operation.suggestion ? `建议：${operation.suggestion}` : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    tone: phase3StatusTone(operation.status),
    text: details.join('；')
  };
}

function asPhase3OperationResult(value: unknown): Phase3OperationResult | undefined {
  const record = asRecord(value);
  if (!record || typeof record.status !== 'string' || !Array.isArray(record.resourceResults)) return undefined;
  return record as unknown as Phase3OperationResult;
}

function phase3StatusTone(status: Phase3OperationResultStatus): UiMessageTone {
  if (status === 'success') return 'success';
  if (status === 'dry_run' || status === 'disabled') return 'info';
  if (status === 'partial_success' || status === 'rolled_back') return 'warn';
  return 'error';
}

function phase3StatusLabel(status: Phase3OperationResultStatus): string {
  switch (status) {
    case 'success': return 'Kit 操作成功';
    case 'failure': return 'Kit 操作失败';
    case 'partial_success': return 'Kit 操作部分成功';
    case 'rolled_back': return 'Kit 操作已回滚';
    case 'rollback_failed': return 'Kit 操作回滚失败';
    case 'blocked': return 'Kit 操作已阻断';
    case 'disabled': return 'Kit 操作不可用';
    case 'dry_run': return 'Kit 操作预览完成';
    default: return `Kit 操作状态：${status}`;
  }
}

function resourceResultSummary(results: Phase3OperationResult['resourceResults']): string | undefined {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const counts = new Map<ResourceChangeStatus, number>();
  for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  const parts = ([
    'success',
    'failure',
    'partial_success',
    'blocked',
    'rolled_back',
    'rollback_failed',
    'skipped',
    'dry_run',
    'disabled',
    'pending'
  ] as ResourceChangeStatus[])
    .flatMap((status) => counts.has(status) ? [`${resourceChangeStatusLabel(status)} ${counts.get(status)}`] : []);
  return parts.length > 0 ? `资源结果：${parts.join(' / ')}` : undefined;
}

function resourceChangeStatusLabel(status: ResourceChangeStatus): string {
  switch (status) {
    case 'success': return '成功';
    case 'failure': return '失败';
    case 'partial_success': return '部分成功';
    case 'rolled_back': return '已回滚';
    case 'rollback_failed': return '回滚失败';
    case 'blocked': return '阻断';
    case 'disabled': return '不可用';
    case 'dry_run': return '预览';
    case 'skipped': return '跳过';
    case 'pending': return '待处理';
    default: return status;
  }
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function customAgentProfileIdentity(agent: VisibleItem, definition: AgentDefinition | undefined, existing: unknown): { profileId: string; agentId: string; displayName: string } {
  const resource = agent.row?.resource;
  const rawAgentId = asText(agent.row?.binding?.agentId ?? resource?.sourceId ?? definition?.id, '');
  const fallbackAgentId = fallbackCustomAgentId(agent, definition);
  const rowAgentId = rawAgentId && rawAgentId !== CUSTOM_AGENT_ID ? rawAgentId : fallbackAgentId;
  const storedProfile = findConfiguredAgentProfile(existing, rowAgentId);
  const storedAgentId = asText(storedProfile?.agentId, '');
  const agentId = storedAgentId && storedAgentId !== CUSTOM_AGENT_ID ? storedAgentId : rowAgentId;
  return {
    profileId: asText(storedProfile?.profileId ?? resource?.metadata.profileId, agentId),
    agentId,
    displayName: asText(storedProfile?.displayName ?? resource?.displayName ?? resource?.name ?? agent.name ?? definition?.label, '自定义目录')
  };
}

function fallbackCustomAgentId(agent: VisibleItem, definition: AgentDefinition | undefined): string {
  const resource = agent.row?.resource;
  const base = normalizeCustomAgentId(asText(resource?.metadata.agentId ?? resource?.displayName ?? resource?.name ?? agent.name ?? definition?.label, 'local'));
  const candidate = base && base !== CUSTOM_AGENT_ID ? base : 'local';
  return candidate.startsWith('custom-') ? candidate : `custom-${candidate}`;
}

function findConfiguredAgentProfile(existing: unknown, agentId: string): Record<string, unknown> | undefined {
  if (!Array.isArray(existing)) return undefined;
  return existing
    .map(asRecord)
    .find((item): item is Record<string, unknown> => {
      if (!item) return false;
      return asText(item.agentId, '') === agentId || asText(item.profileId, '') === agentId;
    });
}

export function upsertAgentProfile(existing: unknown, profile: Record<string, unknown>): Record<string, unknown>[] {
  const current = Array.isArray(existing)
    ? existing.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const profileId = asText(profile.profileId, '');
  const agentId = asText(profile.agentId, '');
  let replaced = false;
  const next = current.map((item) => {
    if (
      (profileId && asText(item.profileId, '') === profileId)
      || (agentId && asText(item.agentId, '') === agentId)
    ) {
      replaced = true;
      return profile;
    }
    return item;
  });
  return replaced ? next : [...next, profile];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

interface CustomAgentProfileDraft {
  profileId: string;
  agentId: string;
  displayName: string;
  rootPath: string;
  rulesText: string;
}

export function buildCustomAgentProfile(input: CustomAgentProfileDraft): { valid: true; profile: Record<string, unknown> } | { valid: false; error: string } {
  const profileId = normalizeCustomAgentId(input.profileId);
  const agentId = normalizeCustomAgentId(input.agentId);
  const root = input.rootPath.trim();
  if (!profileId) return { valid: false, error: 'Profile ID 不能为空，且只能包含字母、数字、点、下划线或连字符。' };
  if (!agentId) return { valid: false, error: 'Agent ID 不能为空，且只能包含字母、数字、点、下划线或连字符。' };
  if (BUILT_IN_AGENT_DEFINITIONS.some((definition) => definition.id === agentId)) return { valid: false, error: 'Agent ID 不能覆盖内置智能体。' };
  if (profileId === CUSTOM_AGENT_ID || agentId === CUSTOM_AGENT_ID) return { valid: false, error: 'custom-directory 是自定义目录入口保留 ID，不能保存为真实 Agent Profile。' };
  if (!input.displayName.trim()) return { valid: false, error: '显示名称不能为空。' };
  if (!root) return { valid: false, error: '根目录不能为空。' };
  if (root.includes('..')) return { valid: false, error: '根目录不能包含父级跳转。' };
  let resourcePaths: Record<string, string[]>;
  try {
    const parsed = JSON.parse(input.rulesText || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { valid: false, error: 'Path Profile 规则必须是 JSON 对象。' };
    resourcePaths = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
    ]));
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Path Profile JSON 解析失败。' };
  }
  if (Object.values(resourcePaths).flat().length === 0) return { valid: false, error: '至少需要一个资源路径规则。' };
  const platform = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win') ? 'windows' : 'macos';
  return {
    valid: true,
    profile: {
      profileId,
      agentId,
      displayName: input.displayName.trim(),
      supportedPlatforms: ['macos', 'windows'],
      rootPaths: [root],
      createdByUser: true,
      lastValidatedAt: new Date().toISOString(),
      capabilities: ['detect', 'global-scope', 'project-scope', 'custom-path', 'settings-read', 'ignore-file', 'file-preview', 'rules', 'memory', 'subagents', 'skills', 'mcp', 'plugins', 'hooks', 'cli', 'permission-extract', 'static-audit', 'backup', 'rollback'],
      pathProfile: {
        platform,
        detectionRoots: [root],
        globalResourcePaths: [root],
        projectResourcePaths: [],
        fallbackRoot: root,
        sourceLevel: 'USER_CONFIG_REQUIRED',
        sourceLevels: ['USER_CONFIG_REQUIRED', 'EA_MANAGED'],
        capabilityStatus: Object.fromEntries(Object.keys(defaultCustomResourcePaths(root)).map((kind) => [kind, resourcePaths[kind]?.length ? 'SUPPORTED' : 'USER_CONFIG_REQUIRED'])),
        resourcePaths,
        notes: ['Custom Agent Profile is user-configured and scanned statically.']
      }
    }
  };
}

function normalizeCustomAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function defaultCustomResourcePaths(rootPath: string): Record<string, string[]> {
  const root = rootPath.trim();
  if (!root) return {};
  const join = (suffix: string) => `${root.replace(/[\\/]$/, '')}/${suffix}`;
  return {
    settings: [join('settings.json'), join('config.json'), join('config.toml')],
    rules: [join('rules/*'), join('AGENTS.md'), join('CLAUDE.md')],
    memory: [join('memory/'), join('memories/')],
    subagents: [join('agents/')],
    'ignore-files': [join('.gitignore'), join('.agentignore')],
    skills: [join('skills/*/SKILL.md'), join('skills/')],
    mcp: [join('mcp.json'), join('.mcp.json')],
    plugins: [join('plugins/')],
    hooks: [join('hooks/'), join('settings.json')],
    cli: [join('commands/'), join('cli.json')],
    files: [join('')]
  };
}

function summarizePermissions(rows: LocalResourceRow[]): string {
  const categories = Array.from(new Set(rows.flatMap((row) => row.resource.permissionSummary.categories)));
  if (categories.length === 0) return '未声明';
  return categories.slice(0, 4).join(' / ');
}

function summarizeAudit(rows: LocalResourceRow[]): string {
  const statuses = rows.map((row) => row.resource.auditSummary.status);
  if (statuses.includes(AuditStatuses.SECURITY_RISK)) return auditStatusLabel(AuditStatuses.SECURITY_RISK);
  if (statuses.includes(AuditStatuses.HIGH_RISK)) return auditStatusLabel(AuditStatuses.HIGH_RISK);
  if (statuses.includes(AuditStatuses.NEEDS_REVIEW)) return auditStatusLabel(AuditStatuses.NEEDS_REVIEW);
  if (statuses.includes(AuditStatuses.LOW_RISK)) return auditStatusLabel(AuditStatuses.LOW_RISK);
  return auditStatusLabel(AuditStatuses.NOT_AUDITED);
}

function formatPathProfile(profile?: Record<string, unknown>): string {
  if (!profile) return 'macOS / Windows Path Profile 未扫描；保留 Dashboard 结构。';
  const platform = asText(profile.platform, '未知平台');
  const sourceLevels = Array.isArray(profile.sourceLevels) ? profile.sourceLevels.join(' + ') : asText(profile.sourceLevel, '来源未知');
  return `macOS / Windows Path Profile 已建模；当前快照平台 ${platform}；来源 ${sourceLevels}`;
}

function capabilityLabel(value: unknown): string {
  switch (value) {
    case 'SUPPORTED': return '已支持';
    case 'USER_CONFIG_REQUIRED': return '需用户配置';
    case 'NOT_APPLICABLE': return '不适用';
    case 'UNCONFIRMED': return '未确认';
    default: return '未配置';
  }
}

function resourceCountForKind(rows: LocalResourceRow[], kind: string): string {
  const typesByKind: Record<string, LocalResourceType[]> = {
    settings: [LocalResourceTypes.AGENT_CONFIG],
    rules: [LocalResourceTypes.RULE],
    subagents: [LocalResourceTypes.SUBAGENT],
    memory: [LocalResourceTypes.MEMORY],
    'ignore-files': [LocalResourceTypes.IGNORE_FILE],
    skills: [LocalResourceTypes.SKILL],
    mcp: [LocalResourceTypes.MCP_SERVER],
    plugins: [LocalResourceTypes.PLUGIN],
    hooks: [LocalResourceTypes.HOOK],
    cli: [LocalResourceTypes.CLI_COMMAND],
    files: [LocalResourceTypes.AGENT_CONFIG, LocalResourceTypes.RULE, LocalResourceTypes.MEMORY, LocalResourceTypes.SUBAGENT, LocalResourceTypes.IGNORE_FILE, LocalResourceTypes.SKILL, LocalResourceTypes.MCP_SERVER, LocalResourceTypes.PLUGIN, LocalResourceTypes.HOOK, LocalResourceTypes.CLI_COMMAND]
  };
  const resourceTypes = typesByKind[kind] ?? [];
  const count = rows.filter((row) => resourceTypes.includes(row.resource.type)).length;
  return count > 0 ? `${count} 个资源` : '未检测';
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueResources(rows: LocalResourceRow[]) {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.resource.id)) return [];
    seen.add(row.resource.id);
    return [row.resource];
  });
}

function isExtensionResource(type: LocalResourceType | string | undefined): boolean {
  return EXTENSION_RESOURCE_TYPES.includes(type as LocalResourceType);
}

function isHookOrCliResource(type: LocalResourceType | string | undefined): boolean {
  return type === LocalResourceTypes.HOOK || type === LocalResourceTypes.CLI_COMMAND;
}

function distributionLabel(rows: LocalResourceRow[]): string {
  if (rows.length === 0) return '未绑定';
  const agents = unique(rows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
  const projects = unique(rows.map((row) => row.binding?.projectId).filter((value): value is string => Boolean(value)));
  if (agents.length === 0 && projects.length === 0) return rows[0].scopeLabel;
  const parts = [
    agents.length > 0 ? `${agents.length} 智能体` : undefined,
    projects.length > 0 ? `${projects.length} 项目` : undefined,
    `${rows.length} 绑定`
  ].filter(Boolean);
  const label = parts.join(' / ');
  return rows.length > 1 ? `多分布：${label}` : label;
}

function summarizeRowsStatus(rows: LocalResourceRow[]): AggregatedResourceStatus {
  if (rows.length === 0) return { key: 'unknown', label: '未知', tone: 'info', source: 'unknown' };
  return rows.find((row) => row.status.tone === 'danger')?.status
    ?? rows.find((row) => row.status.tone === 'warn')?.status
    ?? rows.find((row) => row.status.tone === 'info')?.status
    ?? rows[0].status;
}

function extractPlatforms(metadata: Record<string, unknown> | undefined): string[] {
  const values = [
    ...asStringArray(metadata?.supportedPlatforms),
    ...asStringArray(metadata?.platforms),
    asText(metadata?.platform, '')
  ].filter(Boolean);
  return unique(values.map((value) => String(value).toLowerCase()));
}

function missingProjectItem(projectId: string): VisibleItem {
  return {
    id: `${projectId}:missing-project`,
    name: projectId,
    typeLabel: localResourceTypeLabel(LocalResourceTypes.PROJECT),
    type: LocalResourceTypes.PROJECT,
    scopeLabel: '0 智能体 / 0 资源',
    permissionLabel: '项目路径',
    permissionCategories: [],
    auditLabel: auditStatusLabel(AuditStatuses.NOT_AUDITED),
    auditStatus: AuditStatuses.NOT_AUDITED,
    status: { key: 'missing_project_record', label: '仅有关联资源', tone: 'warn', source: 'resourceBinding' },
    projectId
  };
}

function projectRemovalBlockers(rows: LocalResourceRow[]): LocalResourceRow[] {
  return rows.filter((row) => {
    if (!PROJECT_BLOCKING_RESOURCE_TYPES.includes(row.resource.type)) return false;
    const lifecycle = row.binding?.lifecycleStatus;
    if (lifecycle === LifecycleStatuses.REMOVED || lifecycle === LifecycleStatuses.UNINSTALLED) return false;
    return Boolean(row.binding?.projectId || row.binding?.kitId || row.resource.type === LocalResourceTypes.KIT);
  });
}

function isGlobalScopeRow(row: LocalResourceRow): boolean {
  return row.binding?.scopeType === ResourceScopeTypes.GLOBAL || row.binding?.scopeType === ResourceScopeTypes.AGENT_GLOBAL;
}

function isProjectScopeRow(row: LocalResourceRow): boolean {
  return row.binding?.scopeType === ResourceScopeTypes.PROJECT || row.binding?.scopeType === ResourceScopeTypes.AGENT_PROJECT;
}

function formatSecretRefs(value: unknown): string {
  if (!value) return '未记录';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    return keys.length > 0 ? keys.map((key) => `${key}=***`).join(' / ') : '未记录';
  }
  return '已脱敏';
}

function formatSensitiveVariables(value: unknown): string {
  if (!Array.isArray(value)) return '未记录';
  const names = value.flatMap((item) => {
    const record = asRecord(item);
    return record?.sensitive && typeof record.name === 'string' ? [record.name] : [];
  });
  return names.length > 0 ? names.map((name) => `${name}=***`).join(' / ') : '未记录';
}

function pluginModeLabel(value: unknown): string {
  const normalized = String(value ?? '').toUpperCase().replaceAll('_', '-');
  if (normalized === 'MANAGED-PACKAGE') return 'managed-package';
  if (normalized === 'CONFIG-PLUGIN') return 'config-plugin';
  if (normalized === 'MANUAL-DOWNLOAD') return 'manual-download';
  return '未记录';
}

function resolveKitResourceRow(snapshot: LocalResourceSnapshot, ref: KitResourceRef): LocalResourceRow | undefined {
  return (snapshot.rows ?? []).find((row) => (
    Boolean(ref.resourceId && row.resource.id === ref.resourceId)
    || Boolean(ref.bindingId && row.binding?.id === ref.bindingId)
    || `${row.resource.type}:${row.resource.sourceId ?? row.resource.id}` === ref.refId
  ));
}

function kitHashAnomalies(manifest: KitManifest, snapshot: LocalResourceSnapshot): Array<{ ref: KitResourceRef; reason: string }> {
  return manifest.resources.flatMap((ref) => {
    const expected = manifest.resourceHashes[ref.refId] ?? (ref.resourceId ? manifest.resourceHashes[ref.resourceId] : undefined);
    if (!expected) return [];
    const row = resolveKitResourceRow(snapshot, ref);
    const actual = row ? rowHash(row) : undefined;
    if (!row) return [{ ref, reason: '本机未解析到该资源，无法验证 Hash。' }];
    if (!actual) return [{ ref, reason: '本地资源没有 Hash 记录。' }];
    if (actual !== expected) return [{ ref, reason: 'manifest Hash 与本地资源记录不一致。' }];
    return [];
  });
}

function rowHash(row: LocalResourceRow): string | undefined {
  return row.binding?.currentHash
    ?? row.resource.sha256
    ?? row.resource.packageHash
    ?? row.files[0]?.currentHash
    ?? row.files[0]?.lastKnownHash;
}

function kitApplicationDistribution(rows: LocalResourceRow[]): string {
  if (rows.length === 0) return '未应用';
  const applicationIds = unique(rows.flatMap((row) => {
    const id = asText(row.binding?.metadata?.kitApplicationId, '');
    return id ? [id] : [];
  }));
  return `${distributionLabel(rows)} / ${applicationIds.length || 1} 应用`;
}

function operationResultsFromEvent(event: LocalEventRecord): Array<{ resourceRefId?: string; resourceId?: string; status: string; message: string }> {
  const operationResult = asRecord(event.metadata?.operationResult);
  const resourceResults = operationResult?.resourceResults;
  if (!Array.isArray(resourceResults)) return [];
  return resourceResults.flatMap((result) => {
    const record = asRecord(result);
    if (!record) return [];
    return [{
      resourceRefId: asText(record.resourceRefId, undefined),
      resourceId: asText(record.resourceId, undefined),
      status: asText(record.status, '未知'),
      message: asText(record.message ?? record.failureReason, '无消息')
    }];
  });
}

function filterByQuery(items: VisibleItem[], query: string): VisibleItem[] {
  if (!query.trim()) return items;
  return items.filter((item) => matchesQuery(item, query));
}

function matchesQuery(item: VisibleItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    item.name,
    item.typeLabel,
    item.scopeLabel,
    item.permissionLabel,
    item.auditLabel,
    item.status.label,
    item.path,
    item.source,
    item.version,
    item.agentId,
    item.projectId,
    item.kitId,
    item.eventType,
    item.ruleId,
    item.severity
  ].some((value) => String(value ?? '').toLowerCase().includes(needle));
}

function uniqueOptions(values: string[]): string[] {
  return ['全部', ...Array.from(new Set(values.filter(Boolean)))];
}

function offlineCreatedLabel(value: boolean | undefined): string {
  if (value === true) return '离线生成';
  if (value === false) return '在线生成';
  return '不适用';
}

function timeRangeMatches(filter: string, value: string | undefined): boolean {
  if (filter === '全部') return true;
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const ranges: Record<string, number> = {
    '近24小时': 24 * 60 * 60 * 1000,
    '近7天': 7 * 24 * 60 * 60 * 1000,
    '近30天': 30 * 24 * 60 * 60 * 1000
  };
  const duration = ranges[filter];
  if (!duration) return true;
  return Date.now() - timestamp <= duration;
}

function resourceSubtext(item: VisibleItem): string {
  const parts = [
    item.finding ? `规则 ${item.ruleId}` : undefined,
    item.finding ? `风险 ${item.severity}` : undefined,
    item.type === 'EVENT' && item.source ? item.source : undefined,
    item.syncStatus ? `同步 ${item.syncStatus}` : undefined,
    item.offlineCreated !== undefined ? offlineCreatedLabel(item.offlineCreated) : undefined,
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
