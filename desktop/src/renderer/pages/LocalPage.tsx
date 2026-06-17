import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge } from '../components/StatusBadge';
import { asText, compactDate } from '../lib/formatting';
import { desktopApi } from '../lib/api';
import { kitOperationResults } from '../lib/kit-operation-results';
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
  auditStatusLabel,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  extractKitManifest,
  localResourceTypeLabel,
  type AggregatedResourceStatus,
  type FileBackedResource,
  type KitManifest,
  type KitResourceKind,
  type KitResourceRef,
  type LocalResourceRow,
  type LocalResourceSnapshot,
  type LocalResourceType,
  type PermissionCategory
} from '../../shared/local-resources';
import {
  AGENT_CONFIG_BROWSER_SECTIONS,
  AGENT_EXTENSION_RESOURCE_TYPES,
  resourceTypesForAgentResourceKind,
  type AgentConfigBrowserSection
} from '../../shared/agent-resource-taxonomy';
import type { LoadState, LocalInventoryScanSummary, LocalTab, UiError } from '../types/desktop';

const NAV_ITEMS: Array<{ id: LocalTab; label: string; resourceTypes?: LocalResourceType[] }> = [
  { id: 'overview', label: '概览' },
  { id: 'agents', label: '智能体', resourceTypes: [LocalResourceTypes.AGENT, LocalResourceTypes.AGENT_CONFIG, LocalResourceTypes.RULE, LocalResourceTypes.MEMORY, LocalResourceTypes.SUBAGENT, LocalResourceTypes.IGNORE_FILE] },
  { id: 'extensions', label: '扩展', resourceTypes: [LocalResourceTypes.SKILL, LocalResourceTypes.MCP_SERVER, LocalResourceTypes.PLUGIN, LocalResourceTypes.HOOK, LocalResourceTypes.CLI_COMMAND] },
  { id: 'projects', label: '项目', resourceTypes: [LocalResourceTypes.PROJECT] },
  { id: 'toolkits', label: '工具集', resourceTypes: [LocalResourceTypes.KIT] },
  { id: 'audit', label: '审计' }
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
  { id: 'audit', label: '审计' }
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
  { id: 'audit', label: '审计' }
] as const;

const EXTENSION_RESOURCE_TYPES: readonly LocalResourceType[] = AGENT_EXTENSION_RESOURCE_TYPES;
const EXTENSION_TYPE_FILTER_ORDER = ['Skill', 'MCP', 'Plugin', 'Hook'] as const;
const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
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

const AUDIT_FILTER_OPTIONS = ['全部', '阻断风险', '高风险', '需复核', '低风险', '正常', '未审计'] as const;

const AGENT_ICON_TEXT: Record<string, string> = {
  'claude-code': 'CL',
  codex: 'CX',
  'gemini-cli': 'GM',
  cursor: 'CR',
  antigravity: 'AG',
  copilot: 'CP',
  windsurf: 'WS',
  opencode: 'OC',
  hermes: 'HM',
  'custom-directory': 'AI'
};

type AgentDashboardTab = typeof AGENT_DETAIL_TABS[number]['id'];
type ProjectDetailTab = typeof PROJECT_DETAIL_TABS[number]['id'];
type AgentDefinition = { id: string; label: string; builtIn: boolean };

type VisibleItem = {
  id: string;
  name: string;
  typeLabel: string;
  type: LocalResourceType;
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
  agentId?: string;
  agentIds?: string[];
  projectId?: string;
  projectIds?: string[];
  kitId?: string;
  kitIds?: string[];
  platforms?: string[];
  builtIn?: boolean;
  createdAt?: string;
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
  const [kitQuery, setKitQuery] = useState('');
  const [kitScopeFilter, setKitScopeFilter] = useState('全部');
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
  const auditItems = useMemo(() => createAuditItems(snapshot), [snapshot]);

  const filteredItems = useMemo(() => {
    if (activeTab === 'agents') return agentItems;
    if (activeTab === 'extensions') {
      return extensionItems.filter((item) => (
        matchesQuery(item, extensionQuery)
        && (extensionTypeFilter === '全部' || item.typeLabel === extensionTypeFilter)
        && (extensionAgentFilter === '全部' || item.agentId === extensionAgentFilter || (item.agentIds ?? []).includes(extensionAgentFilter))
        && (extensionSourceFilter === '全部' || item.source === extensionSourceFilter)
      )).sort(compareVisibleItemsByName);
    }
    if (activeTab === 'projects') return projectItems;
    if (activeTab === 'toolkits') {
      return kitItems.filter((item) => (
        matchesQuery(item, kitQuery)
        && (kitScopeFilter === '全部' || kitScopeFilterLabel(item) === kitScopeFilter)
      )).sort(compareKitItems);
    }
    if (activeTab === 'audit') {
      return auditItems.filter((item) => matchesQuery(item, auditQuery) && matchesAuditFilter(item, auditTierFilter));
    }
    return overviewItems;
  }, [activeTab, agentItems, auditItems, auditQuery, auditTierFilter, extensionAgentFilter, extensionItems, extensionQuery, extensionSourceFilter, extensionTypeFilter, kitItems, kitQuery, kitScopeFilter, overviewItems, projectItems]);

  const counts = useMemo(() => Object.fromEntries(NAV_ITEMS.map((item) => [item.id,
    item.id === 'agents' ? agentItems.length
      : item.id === 'extensions' ? extensionItems.length
        : item.id === 'projects' ? projectItems.length
          : item.id === 'toolkits' ? kitItems.length
            : item.id === 'audit' ? auditItems.length
          : createVisibleItems(snapshot, item).length
  ])), [agentItems.length, auditItems.length, extensionItems.length, kitItems.length, projectItems.length, snapshot]);

  const extensionTypeOptions = orderedExtensionTypeOptions(extensionItems.map((item) => item.typeLabel));
  const extensionAgentOptions = uniqueOptions(extensionItems.flatMap((item) => item.agentIds ?? (item.agentId ? [item.agentId] : [])));
  const extensionSourceOptions = uniqueOptions(extensionItems.map((item) => item.source).filter((item): item is string => Boolean(item)));
  const auditTierOptions = useMemo(() => auditFilterOptions(auditItems), [auditItems]);
  const kitScopeOptions = useMemo(() => kitScopeFilterOptions(kitItems), [kitItems]);

  useEffect(() => {
    if (!auditTierOptions.includes(auditTierFilter)) setAuditTierFilter('全部');
  }, [auditTierFilter, auditTierOptions]);

  useEffect(() => {
    if (!kitScopeOptions.includes(kitScopeFilter)) setKitScopeFilter('全部');
  }, [kitScopeFilter, kitScopeOptions]);

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
  const clearKitFilters = () => {
    setKitQuery('');
    setKitScopeFilter('全部');
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
              {offline ? '当前离线：新增服务端动作已暂停。' : '在线状态可用；当前展示真实扫描、Path Profile 和审计摘要。'}
              {' '}失败状态 {snapshot.summary.failureCount}。
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
          kitQuery={kitQuery}
          kitScopeFilter={kitScopeFilter}
          kitScopeOptions={kitScopeOptions}
          kitWorkbenchOpen={kitWorkbenchOpen}
          onExtensionQuery={setExtensionQuery}
          onExtensionTypeFilter={setExtensionTypeFilter}
          onExtensionAgentFilter={setExtensionAgentFilter}
          onExtensionSourceFilter={setExtensionSourceFilter}
          onAuditQuery={setAuditQuery}
          onAuditTierFilter={setAuditTierFilter}
          onKitQuery={setKitQuery}
          onKitScopeFilter={setKitScopeFilter}
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
              onOpenAgentExtensions={(agentId) => {
                setExtensionAgentFilter(agentId);
                switchTab('extensions');
              }}
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
              filterActive={Boolean(kitQuery.trim()) || kitScopeFilter !== '全部'}
              onSelectKit={setSelectedKitId}
              onSelectResource={setSelected}
              onRefreshLocal={onRefreshLocal}
              onClearFilters={clearKitFilters}
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
      <select className="select local-filter-control" value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} disabled={options.length <= 1}>
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
  kitQuery,
  kitScopeFilter,
  kitScopeOptions,
  kitWorkbenchOpen,
  onExtensionQuery,
  onExtensionTypeFilter,
  onExtensionAgentFilter,
  onExtensionSourceFilter,
  onAuditQuery,
  onAuditTierFilter,
  onKitQuery,
  onKitScopeFilter,
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
  kitQuery: string;
  kitScopeFilter: string;
  kitScopeOptions: string[];
  kitWorkbenchOpen: boolean;
  onExtensionQuery: (value: string) => void;
  onExtensionTypeFilter: (value: string) => void;
  onExtensionAgentFilter: (value: string) => void;
  onExtensionSourceFilter: (value: string) => void;
  onAuditQuery: (value: string) => void;
  onAuditTierFilter: (value: string) => void;
  onKitQuery: (value: string) => void;
  onKitScopeFilter: (value: string) => void;
  onToggleKitWorkbench: () => void;
}) {
  if (activeTab === 'extensions') {
    return (
      <section className="local-tab-toolbar" data-testid="local-extensions-toolbar" aria-label="扩展页工具栏">
        <SearchControl label="搜索扩展" value={extensionQuery} onChange={onExtensionQuery} />
        <CompactSelect label="类型" value={extensionTypeFilter} options={extensionTypeOptions} onChange={onExtensionTypeFilter} testId="local-extension-type-filter" />
        {extensionAgentOptions.length > 1 ? <CompactSelect label="智能体" value={extensionAgentFilter} options={extensionAgentOptions} onChange={onExtensionAgentFilter} testId="local-extension-agent-filter" /> : null}
        {extensionSourceOptions.length > 1 ? <CompactSelect label="来源" value={extensionSourceFilter} options={extensionSourceOptions} onChange={onExtensionSourceFilter} testId="local-extension-source-filter" /> : null}
        <span className="meta">{filteredCount} 项</span>
      </section>
    );
  }
  if (activeTab === 'audit') {
    return (
      <section className="local-tab-toolbar" data-testid="local-audit-toolbar" aria-label="审计工具栏">
        <SearchControl label="搜索审计" value={auditQuery} onChange={onAuditQuery} />
        <CompactSelect label="风险" value={auditTierFilter} options={auditTierOptions} onChange={onAuditTierFilter} testId="local-audit-tier-filter" />
        <span className="meta">{filteredCount} 项</span>
      </section>
    );
  }
  if (activeTab === 'agents') {
    return null;
  }
  if (activeTab === 'projects') {
    return null;
  }
  if (activeTab === 'toolkits') {
    return (
      <section className="local-tab-toolbar" data-testid="local-toolkit-toolbar" aria-label="工具集工具栏">
        <Button tone="primary" onClick={onToggleKitWorkbench}>{kitWorkbenchOpen ? '收起新建/导入' : '新建 Kit / 导入'}</Button>
        <SearchControl label="搜索工具集" value={kitQuery} onChange={onKitQuery} />
        <CompactSelect label="范围" value={kitScopeFilter} options={kitScopeOptions} onChange={onKitScopeFilter} testId="local-kit-scope-filter" />
        {!kitWorkbenchOpen ? (
          <>
            <Button onClick={onToggleKitWorkbench}>编辑候选资源</Button>
            <Button onClick={onToggleKitWorkbench}>路径导入/导出</Button>
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
    <label className="local-filter-select local-search-filter">
      <span className="filter-label">{label}</span>
      <span className="local-search-input-wrap">
        <input className="input local-filter-control" type="search" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
        {value ? (
          <button type="button" className="local-search-clear" aria-label={`清空${label}`} onClick={() => onChange('')}>×</button>
        ) : null}
      </span>
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

function compareAuditFindingsByRisk(left: AuditFindingRecord, right: AuditFindingRecord): number {
  const rankDiff = auditFindingRiskRank(right) - auditFindingRiskRank(left);
  if (rankDiff !== 0) return rankDiff;
  const timeDiff = Date.parse(right.detectedAt) - Date.parse(left.detectedAt);
  if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
  return NAME_COLLATOR.compare(left.title, right.title);
}

function auditFindingRiskRank(finding: AuditFindingRecord): number {
  if (finding.blocker || finding.auditStatus === AuditStatuses.SECURITY_RISK) return 5;
  if (finding.auditStatus === AuditStatuses.HIGH_RISK) return 4;
  switch (finding.severity) {
    case 'critical': return 5;
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
    default: return 1;
  }
}

function rowHasAuditEvidence(row: LocalResourceRow): boolean {
  return row.resource.auditSummary.status !== AuditStatuses.NOT_AUDITED
    || row.resource.auditSummary.findingCount > 0
    || (row.findings ?? []).length > 0;
}

function createAuditItems(snapshot: LocalResourceSnapshot): VisibleItem[] {
  return (snapshot.rows ?? [])
    .filter(rowHasAuditEvidence)
    .map(rowToAuditItem)
    .sort(compareAuditItemsByRisk);
}

function rowToAuditItem(row: LocalResourceRow): VisibleItem {
  const item = rowToItem(row);
  const summary = row.resource.auditSummary;
  const findings = row.findings ?? [];
  const findingCount = summary.findingCount || findings.length;
  const trustLabel = summary.trustScore === undefined ? undefined : `Trust ${summary.trustScore}`;
  const countLabel = findingCount > 0 ? `${findingCount} 发现` : undefined;
  return {
    ...item,
    id: `audit:${item.id}`,
    auditLabel: [auditRiskFilterLabel(item), trustLabel, countLabel].filter(Boolean).join(' / '),
    updatedAt: latestAuditDetectedAt(row) ?? item.updatedAt
  };
}

function compareAuditItemsByRisk(left: VisibleItem, right: VisibleItem): number {
  const rankDiff = auditItemRiskRank(right) - auditItemRiskRank(left);
  if (rankDiff !== 0) return rankDiff;
  const timeDiff = Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? '');
  if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
  return compareVisibleItemsByName(left, right);
}

function auditItemRiskRank(item: VisibleItem): number {
  if (auditRiskFilterLabel(item) === '阻断风险') return 5;
  if (item.auditStatus === AuditStatuses.HIGH_RISK || item.status.label === '高风险') return 4;
  if (item.auditStatus === AuditStatuses.NEEDS_REVIEW || item.status.label === '需复核') return 3;
  if (item.auditStatus === AuditStatuses.LOW_RISK) return 2;
  if (item.auditStatus === AuditStatuses.SAFE) return 1;
  return 0;
}

function auditRiskFilterLabel(item: VisibleItem): typeof AUDIT_FILTER_OPTIONS[number] {
  if (item.auditStatus === AuditStatuses.SECURITY_RISK || item.status.label === '阻断风险') return '阻断风险';
  if (item.auditStatus === AuditStatuses.HIGH_RISK || item.status.label === '高风险') return '高风险';
  if (item.auditStatus === AuditStatuses.NEEDS_REVIEW || item.status.label === '需复核') return '需复核';
  if (item.auditStatus === AuditStatuses.LOW_RISK) return '低风险';
  if (item.auditStatus === AuditStatuses.SAFE) return '正常';
  return '未审计';
}

function matchesAuditFilter(item: VisibleItem, filter: string): boolean {
  return filter === '全部' || auditRiskFilterLabel(item) === filter;
}

function auditFilterOptions(items: VisibleItem[]): string[] {
  return AUDIT_FILTER_OPTIONS.filter((option) => option === '全部' || items.some((item) => auditRiskFilterLabel(item) === option));
}

function latestAuditDetectedAt(row: LocalResourceRow): string | undefined {
  return [...(row.findings ?? [])]
    .sort((left, right) => Date.parse(right.detectedAt) - Date.parse(left.detectedAt))[0]?.detectedAt;
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
  const auditFindings = [...(snapshot.findings ?? [])].sort(compareAuditFindingsByRisk).slice(0, 6);
  const auditedCount = (snapshot.rows ?? []).filter((row) => row.resource.auditSummary.status !== AuditStatuses.NOT_AUDITED).length;
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
              <td>审计发现</td>
              <td>{snapshot.findings?.length ?? 0}</td>
            </tr>
            <tr>
              <td>离线状态</td>
              <td>{offline ? '离线' : '在线'}</td>
              <td>已审计资源</td>
              <td>{auditedCount}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>审计风险</h3>
        {auditFindings.length === 0 ? <p className="muted">暂无审计发现。</p> : (
          <table className="table compact-table">
            <tbody>
              {auditFindings.map((finding) => (
                <tr key={finding.id}>
                  <td>{finding.title}</td>
                  <td>{finding.severity}</td>
                  <td>{auditStatusLabel(finding.auditStatus)}</td>
                  <td>{compactDate(finding.detectedAt)}</td>
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
  onOpenAgentExtensions,
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
  onOpenAgentExtensions: (agentId: string) => void;
  onRefreshLocal?: () => void;
}) {
  if (agentItems.length === 0) {
    return <EmptyState title="暂无智能体资源" message={emptyMessage('agents', localScanState, snapshot)} />;
  }

  const defaultAgentId = agentItems.find((item) => item.agentId === 'codex')?.agentId ?? agentItems[0]?.agentId;
  const selectedAgent = agentItems.find((item) => item.agentId === (selectedAgentId ?? defaultAgentId)) ?? agentItems[0];
  const detailAgentId = selectedAgent.agentId ?? AGENT_DEFINITIONS[0].id;
  const detailRows = rowsForAgent(snapshot, detailAgentId);
  const definition = definitionForAgent(detailAgentId);

  return (
    <div className="local-split-layout agent-dashboard-layout" data-testid="agent-dashboard">
      <aside className="local-split-list local-agent-selector" data-testid="local-agent-list" aria-label="智能体列表">
        <AgentSelectorList
          items={agentItems}
          selectedAgentId={detailAgentId}
          onSelectAgent={onSelectAgent}
          onSelectResource={onSelectResource}
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

        <div className="agent-detail-nav" role="tablist" aria-label="智能体详情 Tab">
          {AGENT_DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeDetailTab === tab.id}
              className={`agent-detail-tab ${activeDetailTab === tab.id ? 'active' : ''}`}
              onClick={() => onSelectDetailTab(tab.id)}
              data-testid={`agent-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <AgentTabContent
          agent={selectedAgent}
          definition={definition}
          rows={detailRows}
          snapshot={snapshot}
          activeTab={activeDetailTab}
          settingsConfig={settingsConfig}
          onSelectResource={onSelectResource}
          onOpenAgentExtensions={onOpenAgentExtensions}
          onRefreshLocal={onRefreshLocal}
        />
      </div>
    </div>
  );
}

function AgentSelectorList({
  items,
  selectedAgentId,
  onSelectAgent,
  onSelectResource
}: {
  items: VisibleItem[];
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectResource: (item: VisibleItem) => void;
}) {
  return (
    <div className="agent-selector-list" data-testid="local-agent-selector">
      {items.map((item) => {
        const active = item.agentId === selectedAgentId;
        return (
          <button
            key={item.id}
            type="button"
            className={`agent-selector-row ${active ? 'active' : ''}`}
            aria-pressed={active}
            data-testid={item.agentId ? `local-agent-row-${item.agentId}` : undefined}
            onClick={() => {
              if (item.agentId) onSelectAgent(item.agentId);
              else onSelectResource(item);
            }}
          >
            <AgentIcon agentId={item.agentId} label={item.name} />
            <span className="agent-selector-main">
              <span className="agent-selector-name">{item.name}</span>
              <span className="agent-selector-meta">{item.agentId ?? item.source ?? 'unknown'} · {item.builtIn ? '内置' : '自定义'}</span>
            </span>
            <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
          </button>
        );
      })}
    </div>
  );
}

function AgentIcon({ agentId, label }: { agentId?: string; label: string }) {
  const iconId = agentId ?? label.toLowerCase();
  const testId = `agent-icon-${safeId(iconId)}`;
  return (
    <span className={`agent-selector-icon agent-selector-icon-${safeId(iconId)}`} data-testid={testId} aria-hidden="true">
      <span className="agent-icon-letter">{AGENT_ICON_TEXT[iconId] ?? agentIconFallbackText(label)}</span>
    </span>
  );
}

function agentIconFallbackText(label: string): string {
  const compact = label.trim().replace(/\s+/g, '');
  return compact.slice(0, 2).toUpperCase() || 'AI';
}

function AgentTabContent({
  agent,
  definition,
  rows,
  snapshot,
  activeTab,
  settingsConfig,
  onSelectResource,
  onOpenAgentExtensions,
  onRefreshLocal
}: {
  agent: VisibleItem;
  definition?: AgentDefinition;
  rows: LocalResourceRow[];
  snapshot: LocalResourceSnapshot;
  activeTab: AgentDashboardTab;
  settingsConfig: Record<string, unknown>;
  onSelectResource: (item: VisibleItem) => void;
  onOpenAgentExtensions: (agentId: string) => void;
  onRefreshLocal?: () => void;
}) {
  const tabDefinition = AGENT_DETAIL_TABS.find((tab) => tab.id === activeTab);
  if (activeTab === 'overview') {
    return <AgentOverview agent={agent} definition={definition} rows={rows} snapshot={snapshot} settingsConfig={settingsConfig} onSelectResource={onSelectResource} onOpenAgentExtensions={onOpenAgentExtensions} onRefreshLocal={onRefreshLocal} />;
  }
  if (activeTab === 'files') {
    return <AgentFilesTable rows={rows} onSelectResource={onSelectResource} />;
  }
  if (activeTab === 'audit') {
    const auditRows = rows.filter(rowHasAuditEvidence);
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
  snapshot,
  settingsConfig,
  onSelectResource,
  onOpenAgentExtensions,
  onRefreshLocal
}: {
  agent: VisibleItem;
  definition?: AgentDefinition;
  rows: LocalResourceRow[];
  snapshot: LocalResourceSnapshot;
  settingsConfig: Record<string, unknown>;
  onSelectResource: (item: VisibleItem) => void;
  onOpenAgentExtensions: (agentId: string) => void;
  onRefreshLocal?: () => void;
}) {
  const agentResource = agent.row?.resource;
  const detailAgentId = agent.agentId ?? definition?.id ?? '';
  const profile = asRecord(agentResource?.metadata.pathProfile);
  const configuredProfile = findConfiguredAgentProfile(settingsConfig.agentProfiles, detailAgentId, definition?.builtIn ? detailAgentId : undefined);
  const configuredPathProfile = asRecord(configuredProfile?.pathProfile);
  const editorProfile = configuredPathProfile ?? profile;
  const capabilityStatus = asRecord(profile?.capabilityStatus);
  const auditSummary = summarizeAudit(rows);
  const permissionSummary = summarizePermissions(rows);
  const findingCount = rows.reduce((count, row) => count + row.resource.auditSummary.findingCount, 0);
  const hasConfiguredCustomProfile = Boolean(configuredProfile) || (!definition?.builtIn && Boolean(agentResource?.metadata.customProfileConfigured ?? rows.some((row) => row.resource.type !== LocalResourceTypes.AGENT)));
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <AgentExtensionSummary
        rows={rows}
        agentId={detailAgentId}
        onOpenAgentExtensions={onOpenAgentExtensions}
      />

      <AgentConfigBrowser
        rows={rows}
        onSelectResource={onSelectResource}
        onRefreshLocal={onRefreshLocal}
      />

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
            <td>审计发现</td>
            <td>{findingCount}</td>
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

      <section className="custom-agent-profile-panel" data-testid="custom-agent-profile-summary">
        <header className="section-header">
          <div>
            <h3>{definition?.builtIn ? '自定义路径' : 'Agent Profile 配置'}</h3>
            <p className="muted">{hasConfiguredCustomProfile ? '已保存自定义 Path Profile；扫描结果会并入当前智能体视图。' : '未配置路径规则；需要显式展开后再配置。'}</p>
          </div>
          <Button onClick={() => setProfileEditorOpen((open) => !open)}>{profileEditorOpen ? '收起配置' : hasConfiguredCustomProfile ? '编辑自定义路径' : definition?.builtIn ? '添加自定义路径' : '添加 Agent Profile'}</Button>
        </header>
        {profileEditorOpen ? (
          <CustomAgentProfileEditor
            configured={hasConfiguredCustomProfile}
            agent={agent}
            definition={definition}
            profile={editorProfile}
            settingsConfig={settingsConfig}
            onCancel={() => setProfileEditorOpen(false)}
            onRefreshLocal={onRefreshLocal}
          />
        ) : null}
      </section>

      <div>
        <h3>最近资源</h3>
        <AgentRowsTable rows={rows.slice(0, 5)} emptyTitle="暂无智能体资源" emptyMessage="该智能体尚未扫描到配置、规则、扩展或文件。" onSelectResource={onSelectResource} />
      </div>
    </div>
  );
}

function AgentExtensionSummary({
  rows,
  agentId,
  onOpenAgentExtensions
}: {
  rows: LocalResourceRow[];
  agentId: string;
  onOpenAgentExtensions: (agentId: string) => void;
}) {
  const extensionRows = rows.filter((row) => isAgentExtensionType(row.resource.type));
  const counts = {
    skill: extensionRows.filter((row) => row.resource.type === LocalResourceTypes.SKILL).length,
    mcp: extensionRows.filter((row) => row.resource.type === LocalResourceTypes.MCP_SERVER).length,
    plugin: extensionRows.filter((row) => row.resource.type === LocalResourceTypes.PLUGIN).length,
    hook: extensionRows.filter((row) => row.resource.type === LocalResourceTypes.HOOK).length,
    cli: extensionRows.filter((row) => row.resource.type === LocalResourceTypes.CLI_COMMAND).length
  };
  return (
    <section className="agent-extension-summary" data-testid="agent-extension-summary">
      <div className="agent-extension-counts">
        <strong>{extensionRows.length}</strong>
        <span>扩展资源</span>
        <span>{counts.skill} Skill</span>
        <span>{counts.mcp} MCP</span>
        <span>{counts.plugin} Plugin</span>
        <span>{counts.hook} Hook</span>
        <span>{counts.cli} CLI</span>
      </div>
      <Button onClick={() => onOpenAgentExtensions(agentId)}>在扩展中查看</Button>
    </section>
  );
}

export type AgentConfigEntry = {
  id: string;
  row: LocalResourceRow;
  file?: FileBackedResource;
  title: string;
  path?: string;
};

function AgentConfigBrowser({
  rows,
  onSelectResource,
  onRefreshLocal
}: {
  rows: LocalResourceRow[];
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({});
  const [expandedEntries, setExpandedEntries] = useState<Record<string, boolean>>({});
  const [pathChecks, setPathChecks] = useState<Record<string, { busy: boolean; tone: UiMessageTone; text?: string }>>({});
  const [previews, setPreviews] = useState<Record<string, { busy: boolean; tone: UiMessageTone; text?: string; content?: string }>>({});
  const sectionsWithEntries = AGENT_CONFIG_BROWSER_SECTIONS.map((section) => ({
    section,
    entries: agentConfigEntriesForSection(rows, section)
  })).filter(({ entries }) => entries.length > 0);
  const browserCounts = agentConfigBrowserCounts(sectionsWithEntries.flatMap(({ entries }) => entries));

  const toggleSection = (sectionId: string, baseExpanded: boolean) => {
    setSectionOverrides((current) => ({ ...current, [sectionId]: !(current[sectionId] ?? baseExpanded) }));
  };
  const toggleEntry = (entryId: string) => {
    setExpandedEntries((current) => ({ ...current, [entryId]: !current[entryId] }));
  };
  const checkEntryPath = async (entry: AgentConfigEntry) => {
    if (!agentConfigEntryCanCheck(entry)) return;
    setPathChecks((current) => ({ ...current, [entry.id]: { busy: true, tone: 'info', text: '正在检查真实路径状态。' } }));
    try {
      const result = await desktopApi.local.checkPath(agentConfigEntryPayload(entry)) as { pathStatus: string; message: string; drifted?: boolean };
      setPathChecks((current) => ({
        ...current,
        [entry.id]: {
          busy: false,
          tone: result.pathStatus === PathStatuses.OK ? 'success' : 'error',
          text: `${result.message}${result.drifted ? ' 检测到 Hash 漂移。' : ''}`
        }
      }));
      onRefreshLocal?.();
    } catch (error) {
      setPathChecks((current) => ({
        ...current,
        [entry.id]: { busy: false, tone: 'error', text: error instanceof Error ? error.message : '路径检查失败' }
      }));
    }
  };
  const previewEntryFile = async (entry: AgentConfigEntry) => {
    if (!agentConfigEntryCanPreview(entry)) return;
    setPreviews((current) => ({ ...current, [entry.id]: { busy: true, tone: 'info', text: '正在读取本地文件预览。' } }));
    try {
      const result = await desktopApi.local.previewFile(agentConfigEntryPayload(entry)) as { previewAvailable: boolean; redactedContent?: string; failureReason?: string; suggestion?: string; contentType?: string; size?: number };
      setPreviews((current) => ({
        ...current,
        [entry.id]: result.previewAvailable
          ? {
            busy: false,
            tone: 'success',
            text: `文件预览已脱敏：${result.contentType ?? entry.file?.contentType ?? 'text'} / ${result.size ?? entry.file?.size ?? 0} bytes。`,
            content: result.redactedContent ?? ''
          }
          : {
            busy: false,
            tone: 'error',
            text: `${result.failureReason ?? '文件预览不可用'}${result.suggestion ? ` ${result.suggestion}` : ''}`
          }
      }));
      onRefreshLocal?.();
    } catch (error) {
      setPreviews((current) => ({
        ...current,
        [entry.id]: { busy: false, tone: 'error', text: error instanceof Error ? error.message : '文件预览失败' }
      }));
    }
  };

  return (
    <section className="agent-config-browser" data-testid="agent-config-browser">
      <header className="section-header">
        <div>
          <h3>配置文件浏览</h3>
          <p className="muted">{browserCounts.entryCount} 条目 / {browserCounts.fileCount} 文件</p>
        </div>
      </header>
      <div className="agent-config-sections">
        {sectionsWithEntries.length === 0 ? <p className="agent-config-empty">未检测到可浏览的智能体配置文件。</p> : sectionsWithEntries.map(({ section, entries }) => {
          const expanded = sectionOverrides[section.id] ?? entries.length > 0;
          return (
            <section className="agent-config-section" key={section.id} data-testid={`agent-config-section-${section.id}`}>
              <button
                type="button"
                className="agent-config-section-header"
                aria-expanded={expanded}
                onClick={() => toggleSection(section.id, entries.length > 0)}
              >
                <span className="agent-config-chevron">{expanded ? '⌄' : '›'}</span>
                <strong>{section.label}</strong>
                <span className="pill">{entries.length}</span>
              </button>
              {expanded ? (
                <div className="agent-config-entry-list">
                  {entries.map((entry) => {
                    const entryExpanded = Boolean(expandedEntries[entry.id]);
                    return (
                      <AgentConfigEntryRow
                        key={entry.id}
                        entry={entry}
                        expanded={entryExpanded}
                        pathCheck={pathChecks[entry.id]}
                        preview={previews[entry.id]}
                        onToggle={() => toggleEntry(entry.id)}
                        onSelectResource={onSelectResource}
                        onCheckPath={() => checkEntryPath(entry)}
                        onPreviewFile={() => previewEntryFile(entry)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function AgentConfigEntryRow({
  entry,
  expanded,
  pathCheck,
  preview,
  onToggle,
  onSelectResource,
  onCheckPath,
  onPreviewFile
}: {
  entry: AgentConfigEntry;
  expanded: boolean;
  pathCheck?: { busy: boolean; tone: UiMessageTone; text?: string };
  preview?: { busy: boolean; tone: UiMessageTone; text?: string; content?: string };
  onToggle: () => void;
  onSelectResource: (item: VisibleItem) => void;
  onCheckPath: () => void;
  onPreviewFile: () => void;
}) {
  const canCheck = agentConfigEntryCanCheck(entry);
  const canPreview = agentConfigEntryCanPreview(entry);
  const detailItem = entry.file ? fileToItem(entry.file, entry.row) : rowToItem(entry.row);
  const pathActionTitle = canCheck ? '真实读取绑定路径状态并记录检查结果' : '需要本地资源绑定后才能检查路径';
  const previewActionTitle = canPreview ? '真实读取绑定文件并脱敏展示' : '需要本地资源绑定和可预览文件';
  return (
    <div className="agent-config-entry" data-testid={`agent-config-entry-${safeId(entry.id)}`}>
      <button
        type="button"
        className="agent-config-entry-main"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="agent-config-chevron">{expanded ? '⌄' : '›'}</span>
        <span className="agent-config-entry-title">{entry.title}</span>
        <span className="scope-pill">{entry.row.scopeLabel}</span>
        <span className="agent-config-entry-path">{entry.path ?? '未绑定路径'}</span>
        <StatusBadge tone={entry.row.status.tone}>{entry.row.status.label}</StatusBadge>
        <span className="agent-config-entry-size">{entry.file ? fileSizeLabel(entry.file.size) : localResourceTypeLabel(entry.row.resource.type)}</span>
      </button>
      {expanded ? (
        <div className="agent-config-entry-detail">
          <div className="agent-config-entry-meta">
            <DetailLine label="权限" value={entry.row.resource.permissionSummary.label || '未声明'} />
            <DetailLine label="审计" value={auditStatusLabel(entry.row.resource.auditSummary.status)} />
            <DetailLine label="Hash" value={entry.file?.currentHash ?? entry.file?.lastKnownHash ?? entry.row.binding?.currentHash ?? entry.row.resource.sha256} />
          </div>
          <div className="card-action-row">
            <Button onClick={() => onSelectResource(detailItem)}>打开详情</Button>
            <Button disabled={!canCheck || pathCheck?.busy} title={pathActionTitle} onClick={onCheckPath}>{pathCheck?.busy ? '检查中' : '检查路径'}</Button>
            <Button disabled={!canPreview || preview?.busy} title={previewActionTitle} onClick={onPreviewFile}>{preview?.busy ? '预览中' : '读取脱敏预览'}</Button>
          </div>
          {pathCheck?.text ? <p className="muted" style={messageStyle(pathCheck.tone)} role="status">{pathCheck.text}</p> : null}
          {preview?.text ? <p className="muted" style={messageStyle(preview.tone)} role="status">{preview.text}</p> : null}
          {preview?.content !== undefined ? <pre className="agent-config-preview">{preview.content}</pre> : null}
        </div>
      ) : null}
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
  snapshot,
  activeTab,
  onSelectResource,
  onRefreshLocal
}: {
  project: VisibleItem;
  projectId: string;
  rows: LocalResourceRow[];
  snapshot: LocalResourceSnapshot;
  activeTab: ProjectDetailTab;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  if (activeTab === 'overview') {
    return <ProjectOverview project={project} projectId={projectId} rows={rows} snapshot={snapshot} onSelectResource={onSelectResource} onRefreshLocal={onRefreshLocal} />;
  }
  if (activeTab === 'audit') {
    const auditRows = rows.filter(rowHasAuditEvidence);
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
  snapshot,
  onSelectResource,
  onRefreshLocal
}: {
  project: VisibleItem;
  projectId: string;
  rows: LocalResourceRow[];
  snapshot: LocalResourceSnapshot;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
}) {
  const projectRow = rows.find((row) => row.resource.type === LocalResourceTypes.PROJECT) ?? project.row;
  const associatedRows = rows.filter((row) => row.resource.type !== LocalResourceTypes.PROJECT);
  const agents = unique(associatedRows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
  const auditRisk = summarizeAudit(associatedRows.length > 0 ? associatedRows : rows);
  const findingCount = associatedRows.reduce((count, row) => count + row.resource.auditSummary.findingCount, 0);
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
            <td>审计发现</td>
            <td>{findingCount}</td>
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
  filterActive,
  onSelectKit,
  onSelectResource,
  onRefreshLocal,
  onClearFilters
}: {
  kitItems: VisibleItem[];
  snapshot: LocalResourceSnapshot;
  selectedKitId?: string;
  workbenchOpen: boolean;
  filterActive: boolean;
  onSelectKit: (kitId: string) => void;
  onSelectResource: (item: VisibleItem) => void;
  onRefreshLocal?: () => void;
  onClearFilters: () => void;
}) {
  const [selectedKitIds, setSelectedKitIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<KitDialogState>();
  const selectedKit = kitItems.find((item) => item.kitId === selectedKitId) ?? kitItems[0];
  const manifest = selectedKit ? extractKitManifest(selectedKit.row?.resource.metadata) : undefined;
  const compactKitActions = compactKitActionSummary(snapshot, manifest);
  const selectedManifests = kitItems
    .filter((item) => item.kitId && selectedKitIds.includes(item.kitId))
    .flatMap((item) => {
      const candidate = extractKitManifest(item.row?.resource.metadata);
      return candidate ? [candidate] : [];
    });
  const closeDialog = () => setDialog(undefined);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} data-testid="toolkit-page">
      {workbenchOpen ? (
        <KitWorkbench snapshot={snapshot} selectedManifest={manifest} onRefreshLocal={onRefreshLocal} />
      ) : compactKitActions ? <p className="muted">{compactKitActions}</p> : null}
      {kitItems.length === 0 ? (
        <section className="panel kit-empty-state" data-testid="kit-empty-state">
          <EmptyState title={filterActive ? '没有匹配的工具集' : '暂无工具集资源'} message={filterActive ? '当前搜索或范围筛选没有匹配任何 Kit。' : '没有符合当前页面的真实本地资源；可通过上方新建/导入入口创建 KitManifest。'} />
          {filterActive ? <Button onClick={onClearFilters}>清空筛选</Button> : null}
        </section>
      ) : (
        <>
          <KitSelectionBar
            selectedManifests={selectedManifests}
            onClear={() => setSelectedKitIds([])}
            onBatchInstall={() => setDialog({ type: 'batch-install', manifests: selectedManifests })}
          />
          <div className="kit-page-layout">
            <KitFolderGrid
              kitItems={kitItems}
              selectedKitId={selectedKit?.kitId}
              selectedKitIds={selectedKitIds}
              snapshot={snapshot}
              onSelectKit={(kitId) => {
                onSelectKit(kitId);
              }}
              onToggleKit={(kitId) => setSelectedKitIds((current) => current.includes(kitId) ? current.filter((id) => id !== kitId) : [...current, kitId])}
            />
            {manifest && selectedKit ? (
              <KitDetail
                item={selectedKit}
                manifest={manifest}
                snapshot={snapshot}
                onSelectResource={onSelectResource}
                onEdit={() => setDialog({ type: 'edit', manifest })}
                onExport={() => setDialog({ type: 'export', manifest })}
                onInstall={() => setDialog({ type: 'install', manifest })}
                onRemove={() => setDialog({ type: 'remove', manifest })}
                onDelete={() => setDialog({ type: 'delete', manifest })}
              />
            ) : (
              <EmptyState title="Kit manifest 缺失" message="当前记录没有有效 KitManifest；不会作为工具集运行路径处理。" />
            )}
          </div>
          {dialog?.type === 'edit' ? (
            <KitEditorDialog snapshot={snapshot} manifest={dialog.manifest} onClose={closeDialog} onRefreshLocal={onRefreshLocal} />
          ) : null}
          {dialog?.type === 'install' ? (
            <KitInstallDialog snapshot={snapshot} manifests={[dialog.manifest]} onClose={closeDialog} onRefreshLocal={onRefreshLocal} />
          ) : null}
          {dialog?.type === 'batch-install' ? (
            <KitInstallDialog snapshot={snapshot} manifests={dialog.manifests} onClose={closeDialog} onRefreshLocal={onRefreshLocal} />
          ) : null}
          {dialog?.type === 'remove' ? (
            <KitRemoveDialog snapshot={snapshot} manifest={dialog.manifest} onClose={closeDialog} onRefreshLocal={onRefreshLocal} />
          ) : null}
          {dialog?.type === 'delete' ? (
            <KitDeleteDialog snapshot={snapshot} manifest={dialog.manifest} onClose={closeDialog} onRefreshLocal={onRefreshLocal} />
          ) : null}
          {dialog?.type === 'export' ? (
            <KitExportDialog manifest={dialog.manifest} onClose={closeDialog} onRefreshLocal={onRefreshLocal} />
          ) : null}
        </>
      )}
    </div>
  );
}

type KitDialogState =
  | { type: 'edit'; manifest?: KitManifest }
  | { type: 'install'; manifest: KitManifest }
  | { type: 'batch-install'; manifests: KitManifest[] }
  | { type: 'remove'; manifest: KitManifest }
  | { type: 'delete'; manifest: KitManifest }
  | { type: 'export'; manifest: KitManifest };

function KitSelectionBar({
  selectedManifests,
  onClear,
  onBatchInstall
}: {
  selectedManifests: KitManifest[];
  onClear: () => void;
  onBatchInstall: () => void;
}) {
  if (selectedManifests.length === 0) return null;
  const resourceCount = selectedManifests.reduce((sum, manifest) => sum + manifest.resources.length, 0);
  return (
    <section className="kit-selection-bar" data-testid="kit-selection-bar" aria-label="已选择工具集">
      <span>{selectedManifests.length} 个 Kit 已选择</span>
      <span className="meta">{resourceCount} 个资源将进入批量安装预览</span>
      <Button tone="primary" onClick={onBatchInstall}>批量安装</Button>
      <Button tone="ghost" onClick={onClear}>清空选择</Button>
    </section>
  );
}

function KitFolderGrid({
  kitItems,
  selectedKitId,
  selectedKitIds,
  snapshot,
  onSelectKit,
  onToggleKit
}: {
  kitItems: VisibleItem[];
  selectedKitId?: string;
  selectedKitIds: string[];
  snapshot: LocalResourceSnapshot;
  onSelectKit: (kitId: string) => void;
  onToggleKit: (kitId: string) => void;
}) {
  return (
    <section className="kit-folder-grid" data-testid="kit-folder-grid" aria-label="工具集文件夹">
      {kitItems.map((item) => {
        const manifest = extractKitManifest(item.row?.resource.metadata);
        if (!manifest || !item.kitId) return null;
        const metrics = kitManifestMetrics(snapshot, manifest);
        const selected = selectedKitId === item.kitId;
        const checked = selectedKitIds.includes(item.kitId);
        return (
          <article key={item.id} className={`kit-folder-card ${selected ? 'active' : ''}`} data-testid={`kit-card-${safeId(item.kitId)}`}>
            <div className="kit-folder-card-top">
              <label className="kit-card-check" aria-label={`选择 ${manifest.name}`}>
                <input type="checkbox" checked={checked} onChange={() => onToggleKit(item.kitId as string)} />
              </label>
              <button type="button" className="kit-folder-open" onClick={() => onSelectKit(item.kitId as string)}>
                <span className="kit-folder-icon" aria-hidden="true">KIT</span>
                <span>
                  <strong>{manifest.name}</strong>
                  <small>{manifest.kitId}</small>
                </span>
              </button>
            </div>
            <p className="muted">{manifest.description || '暂无描述'}</p>
            <div className="kit-card-tags" aria-label="工具集资源统计">
              <span>{manifest.resources.length} 资源</span>
              <span>{metrics.skillCount} Skill</span>
              <span>{metrics.mcpCount} MCP</span>
              <span>{metrics.configCount} Config</span>
            </div>
            <div className="kit-card-footer">
              <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
              <span className="meta">{kitScopeFilterLabel(item)} · v{manifest.version}</span>
            </div>
          </article>
        );
      })}
    </section>
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

function kitScopeFilterLabel(item: VisibleItem): string {
  if (item.status.key === 'kit_unapplied' || item.scopeLabel === '未应用') return '未应用';
  const hasAgent = (item.agentIds ?? []).length > 0 || Boolean(item.agentId);
  const hasProject = (item.projectIds ?? []).length > 0 || Boolean(item.projectId);
  if (hasAgent && hasProject) return '智能体+项目';
  if (hasProject) return '项目';
  if (hasAgent) return '智能体';
  return '本地';
}

function kitScopeFilterOptions(items: VisibleItem[]): string[] {
  return ['全部', ...Array.from(new Set(items.map(kitScopeFilterLabel)))];
}

function compareKitItems(left: VisibleItem, right: VisibleItem): number {
  const statusDiff = kitStatusRank(right) - kitStatusRank(left);
  if (statusDiff !== 0) return statusDiff;
  return compareVisibleItemsByName(left, right);
}

function kitStatusRank(item: VisibleItem): number {
  if (item.status.tone === 'danger') return 5;
  if (item.status.label === '授权收缩') return 4;
  if (item.status.label === 'Hash 异常') return 3;
  if (item.status.label === '未应用') return 2;
  return 1;
}

function kitManifestMetrics(snapshot: LocalResourceSnapshot, manifest: KitManifest): { skillCount: number; mcpCount: number; configCount: number } {
  const skillCount = manifest.resources.filter((ref) => ref.resourceType === LocalResourceTypes.SKILL).length;
  const mcpCount = manifest.resources.filter((ref) => ref.resourceType === LocalResourceTypes.MCP_SERVER).length;
  const configTypes = new Set<KitResourceKind>([LocalResourceTypes.RULE, LocalResourceTypes.MEMORY, LocalResourceTypes.AGENT_CONFIG, LocalResourceTypes.SUBAGENT, LocalResourceTypes.IGNORE_FILE]);
  const configCount = manifest.resources.filter((ref) => configTypes.has(ref.resourceType)).length;
  const resolved = rowsForKitResources(snapshot, manifest).length;
  return { skillCount, mcpCount, configCount: configCount || Math.max(0, resolved - skillCount - mcpCount) };
}

function kitEditorCandidates(snapshot: LocalResourceSnapshot, tab: KitEditorTab): KitEditorCandidate[] {
  const allowed = tab === 'skills'
    ? new Set<LocalResourceType>([LocalResourceTypes.SKILL, LocalResourceTypes.PLUGIN, LocalResourceTypes.HOOK, LocalResourceTypes.CLI_COMMAND])
    : tab === 'mcp'
      ? new Set<LocalResourceType>([LocalResourceTypes.MCP_SERVER])
      : new Set<LocalResourceType>([LocalResourceTypes.RULE, LocalResourceTypes.MEMORY, LocalResourceTypes.AGENT_CONFIG, LocalResourceTypes.SUBAGENT, LocalResourceTypes.IGNORE_FILE]);
  const seen = new Set<string>();
  return (snapshot.rows ?? [])
    .filter((row) => allowed.has(row.resource.type))
    .flatMap((row) => {
      const refId = kitRefIdForRow(row);
      if (seen.has(refId)) return [];
      seen.add(refId);
      return [{
        refId,
        row,
        title: row.resource.displayName || row.resource.name,
        subtitle: [localResourceTypeLabel(row.resource.type), row.binding?.agentId, row.binding?.projectId, row.binding?.targetPath ?? row.resource.sourcePath].filter(Boolean).join(' / ')
      }];
    })
    .sort((left, right) => NAME_COLLATOR.compare(left.title, right.title));
}

function buildKitManifestFromSelection(input: {
  snapshot: LocalResourceSnapshot;
  existing?: KitManifest;
  kitId: string;
  name: string;
  version: string;
  description?: string;
  selectedResourceIds: string[];
}): KitManifest {
  const candidates = new Map<string, LocalResourceRow>();
  for (const tab of KIT_EDITOR_TABS) {
    for (const candidate of kitEditorCandidates(input.snapshot, tab.id)) {
      candidates.set(candidate.refId, candidate.row);
    }
  }
  const resources = input.selectedResourceIds.flatMap((refId) => {
    const row = candidates.get(refId) ?? input.snapshot.rows.find((candidate) => kitRefIdForRow(candidate) === refId);
    return row && isKitResourceKind(row.resource.type) ? [kitResourceRefFromRow(row)] : [];
  });
  const rows = resources.flatMap((ref) => {
    const row = resolveKitResourceRow(input.snapshot, ref);
    return row ? [row] : [];
  });
  const resourceHashes = Object.fromEntries(resources.flatMap((ref) => {
    const row = resolveKitResourceRow(input.snapshot, ref);
    const hash = row?.resource.sha256 ?? row?.resource.packageHash;
    return hash ? [[ref.refId, hash]] : [];
  }));
  return {
    kitId: input.kitId,
    name: input.name,
    version: input.version,
    description: input.description,
    sourceType: input.existing?.sourceType ?? 'local',
    createdAt: input.existing?.createdAt ?? new Date().toISOString(),
    supportedAgents: unique(rows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value))),
    supportedPlatforms: input.existing?.supportedPlatforms ?? ['macos'],
    resources,
    permissionSummary: rows.length > 0 ? mergePermissionSummary(rows) : createEmptyPermissionSummary('未声明'),
    auditSummary: rows.length > 0 ? mergeAuditSummary(rows) : createNotAuditedSummary(),
    requiredAuthorizations: input.existing?.requiredAuthorizations ?? [],
    resourceHashes,
    dependencies: input.existing?.dependencies ?? [],
    conflictPolicy: input.existing?.conflictPolicy ?? 'prompt',
    rollbackPolicy: input.existing?.rollbackPolicy ?? 'best-effort',
    metadata: {
      ...(input.existing?.metadata ?? {}),
      editedFromLocalPage: true,
      editorResourceCount: resources.length
    }
  };
}

function kitRefIdForRow(row: LocalResourceRow): string {
  return `${row.resource.type}:${row.resource.sourceId || row.resource.id}`;
}

function kitResourceRefFromRow(row: LocalResourceRow): KitResourceRef {
  return {
    refId: kitRefIdForRow(row),
    resourceType: row.resource.type as KitResourceKind,
    resourceId: row.resource.id,
    sourcePath: row.resource.sourcePath,
    targetPath: row.binding?.targetPath,
    bindingId: row.binding?.id,
    required: true,
    metadata: {
      sourceId: row.resource.sourceId,
      agentId: row.binding?.agentId,
      projectId: row.binding?.projectId,
      sourceType: row.resource.sourceType
    }
  };
}

function mergePermissionSummary(rows: LocalResourceRow[]) {
  const categories = Array.from(new Set(rows.flatMap((row) => row.resource.permissionSummary.categories)));
  const items = Array.from(new Set(rows.flatMap((row) => row.resource.permissionSummary.items)));
  return {
    ...createEmptyPermissionSummary(categories.length > 0 ? categories.join(' / ') : '未声明'),
    declared: rows.some((row) => row.resource.permissionSummary.declared),
    categories,
    items,
    details: rows.flatMap((row) => row.resource.permissionSummary.details ?? [])
  };
}

function mergeAuditSummary(rows: LocalResourceRow[]) {
  const rank = (status: string) => status === AuditStatuses.SECURITY_RISK ? 5 : status === AuditStatuses.HIGH_RISK ? 4 : status === AuditStatuses.NEEDS_REVIEW ? 3 : status === AuditStatuses.LOW_RISK ? 2 : status === AuditStatuses.SAFE ? 1 : 0;
  const status = rows.map((row) => row.resource.auditSummary.status).sort((left, right) => rank(right) - rank(left))[0] ?? AuditStatuses.NOT_AUDITED;
  const findingCount = rows.reduce((sum, row) => sum + row.resource.auditSummary.findingCount, 0);
  return {
    status,
    trustScore: Math.min(...rows.map((row) => row.resource.auditSummary.trustScore ?? 100)),
    findingCount,
    criticalCount: rows.reduce((sum, row) => sum + row.resource.auditSummary.criticalCount, 0),
    highCount: rows.reduce((sum, row) => sum + row.resource.auditSummary.highCount, 0),
    message: findingCount > 0 ? `${findingCount} 项资源审计发现` : '由本地资源摘要生成'
  };
}

type KitConflict = { kind: string; refId: string; message: string };

function kitConflictPreview(snapshot: LocalResourceSnapshot, manifest: KitManifest): KitConflict[] {
  const missing = manifest.resources.flatMap((ref) => resolveKitResourceRow(snapshot, ref) ? [] : [{
    kind: ref.required ? '缺失资源' : '可选缺失',
    refId: ref.refId,
    message: ref.required ? 'Kit 必需资源在本机不存在。' : '可选资源未在本机解析。'
  }]);
  const hash = kitHashAnomalies(manifest, snapshot).map((anomaly) => ({
    kind: 'Hash 异常',
    refId: anomaly.ref.refId,
    message: anomaly.reason
  }));
  const auth = rowsForKitResources(snapshot, manifest)
    .filter((row) => row.binding?.authStatus === AuthStatuses.AUTH_REVOKED || row.binding?.authStatus === AuthStatuses.SECURITY_DELISTED)
    .map((row) => ({
      kind: '授权收缩',
      refId: kitRefIdForRow(row),
      message: '授权收缩资源会阻断或降级 Kit 安装。'
    }));
  const installed = kitApplications(snapshot, manifest).map((application) => ({
    kind: '已安装记录',
    refId: application.applicationId,
    message: `${application.count} 个托管绑定已存在，可选择覆盖或移除后重装。`
  }));
  return [...missing, ...hash, ...auth, ...installed];
}

function kitInstallStepLabel(step: KitInstallStep): string {
  switch (step) {
    case 'kit': return '选择 Kit';
    case 'config': return '安装配置';
    case 'preview': return '冲突预览';
    case 'install': return '安装结果';
  }
}

function agentOptionsForKit(snapshot: LocalResourceSnapshot): string[] {
  return unique(snapshot.rows.flatMap((row) => row.binding?.agentId ? [row.binding.agentId] : []));
}

function projectOptionsForKit(snapshot: LocalResourceSnapshot): string[] {
  return unique(snapshot.rows.flatMap((row) => row.binding?.projectId ? [row.binding.projectId] : []));
}

function kitInstallTargets(input: { agentIds: string[]; projectId: string; customPath: string }): Array<{ scopeType: string; agentId?: string; projectId?: string; scopePath?: string }> {
  const customPath = input.customPath.trim();
  if (customPath) return [{ scopeType: ResourceScopeTypes.CUSTOM_PATH, scopePath: customPath }];
  if (input.agentIds.length > 0 && input.projectId) {
    return input.agentIds.map((agentId) => ({ scopeType: ResourceScopeTypes.AGENT_PROJECT, agentId, projectId: input.projectId }));
  }
  if (input.projectId) return [{ scopeType: ResourceScopeTypes.PROJECT, projectId: input.projectId }];
  return input.agentIds.map((agentId) => ({ scopeType: ResourceScopeTypes.AGENT_GLOBAL, agentId }));
}

function kitApplications(snapshot: LocalResourceSnapshot, manifest: KitManifest): Array<{ applicationId: string; targets: string[]; count: number }> {
  const groups = new Map<string, { targets: Set<string>; count: number }>();
  for (const row of rowsForKit(snapshot, manifest.kitId)) {
    const applicationId = asText(row.binding?.metadata?.kitApplicationId, '');
    if (!applicationId) continue;
    const group = groups.get(applicationId) ?? { targets: new Set<string>(), count: 0 };
    group.count += 1;
    group.targets.add([row.binding?.agentId, row.binding?.projectId, row.binding?.targetPath].filter(Boolean).join(' / ') || row.scopeLabel);
    groups.set(applicationId, group);
  }
  return [...groups.entries()].map(([applicationId, group]) => ({
    applicationId,
    targets: [...group.targets],
    count: group.count
  }));
}

function isKitResourceKind(type: string): type is KitResourceKind {
  return type === LocalResourceTypes.SKILL
    || type === LocalResourceTypes.MCP_SERVER
    || type === LocalResourceTypes.PLUGIN
    || type === LocalResourceTypes.HOOK
    || type === LocalResourceTypes.CLI_COMMAND
    || type === LocalResourceTypes.RULE
    || type === LocalResourceTypes.MEMORY
    || type === LocalResourceTypes.SUBAGENT
    || type === LocalResourceTypes.AGENT_CONFIG
    || type === LocalResourceTypes.IGNORE_FILE;
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
      <h3>Kit 新建、编辑与导入</h3>
      <KitEditorForm snapshot={snapshot} manifest={selectedManifest} onSaved={onRefreshLocal} />
      <div className="section-divider" />
      <h3>路径导入与快速生成</h3>
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

type KitEditorTab = 'skills' | 'mcp' | 'configs';
const KIT_EDITOR_TABS: Array<{ id: KitEditorTab; label: string }> = [
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP' },
  { id: 'configs', label: 'Configs' }
];

type KitEditorCandidate = {
  refId: string;
  row: LocalResourceRow;
  title: string;
  subtitle: string;
};

export function KitEditorForm({
  snapshot,
  manifest,
  onSaved,
  onClose
}: {
  snapshot: LocalResourceSnapshot;
  manifest?: KitManifest;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<KitEditorTab>('skills');
  const [kitId, setKitId] = useState(manifest?.kitId ?? `kit.${Date.now()}`);
  const [name, setName] = useState(manifest?.name ?? 'New Kit');
  const [version, setVersion] = useState(manifest?.version ?? '1.0.0');
  const [description, setDescription] = useState(manifest?.description ?? '');
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>(manifest?.resources.map((ref) => ref.refId) ?? []);
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [busy, setBusy] = useState(false);
  const candidates = useMemo(() => kitEditorCandidates(snapshot, activeTab), [activeTab, snapshot]);

  useEffect(() => {
    setKitId(manifest?.kitId ?? `kit.${Date.now()}`);
    setName(manifest?.name ?? 'New Kit');
    setVersion(manifest?.version ?? '1.0.0');
    setDescription(manifest?.description ?? '');
    setSelectedResourceIds(manifest?.resources.map((ref) => ref.refId) ?? []);
  }, [manifest?.kitId]);

  const toggleRef = (refId: string) => {
    setSelectedResourceIds((current) => current.includes(refId) ? current.filter((value) => value !== refId) : [...current, refId]);
  };
  const save = async () => {
    const trimmedKitId = kitId.trim();
    const trimmedName = name.trim();
    if (!trimmedKitId || !trimmedName) {
      setMessage({ tone: 'error', text: 'Kit ID 和名称不能为空。' });
      return;
    }
    const nextManifest = buildKitManifestFromSelection({
      snapshot,
      existing: manifest,
      kitId: trimmedKitId,
      name: trimmedName,
      version: version.trim() || '1.0.0',
      description: description.trim() || undefined,
      selectedResourceIds
    });
    if (nextManifest.resources.length === 0) {
      setMessage({ tone: 'error', text: '至少选择一个 Skill、MCP 或配置资源。' });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await desktopApi.kit.importManifest({ manifest: nextManifest, sourcePath: `kit-editor://${nextManifest.kitId}` });
      setMessage(phase3OperationMessage(result, manifest ? 'Kit 已更新到本地资源图。' : 'Kit 已新建到本地资源图。'));
      onSaved?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kit 保存失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="kit-editor" data-testid="kit-editor">
      <div className="grid kit-editor-fields">
        <label>
          <span className="filter-label">Kit ID</span>
          <input className="input" value={kitId} onChange={(event) => setKitId(event.target.value)} />
        </label>
        <label>
          <span className="filter-label">名称</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
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
      <div className="segmented kit-editor-tabs" role="tablist" aria-label="Kit 资源类型">
        {KIT_EDITOR_TABS.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="kit-candidate-list" data-testid={`kit-editor-${activeTab}`}>
        {candidates.length === 0 ? <p className="muted">当前扫描快照没有可加入此分组的资源。</p> : candidates.map((candidate) => (
          <label key={candidate.refId} className="kit-candidate-row">
            <input type="checkbox" checked={selectedResourceIds.includes(candidate.refId)} onChange={() => toggleRef(candidate.refId)} />
            <span>
              <strong>{candidate.title}</strong>
              <small>{candidate.subtitle}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="kit-editor-selected" aria-label="已选资源">
        {selectedResourceIds.length === 0 ? <span className="muted">尚未选择资源。</span> : selectedResourceIds.slice(0, 12).map((refId) => <span key={refId}>{refId}</span>)}
        {selectedResourceIds.length > 12 ? <span>+{selectedResourceIds.length - 12}</span> : null}
      </div>
      {message ? <p className="muted" role="status" style={messageStyle(message.tone)}>{message.text}</p> : null}
      <div className="card-action-row">
        {onClose ? <Button onClick={onClose}>取消</Button> : null}
        <Button tone="ghost" onClick={() => setSelectedResourceIds([])}>清空选择</Button>
        <Button tone="primary" disabled={busy} onClick={save}>{busy ? '保存中' : manifest ? '保存 Kit' : '新建 Kit'}</Button>
      </div>
    </section>
  );
}

function KitEditorDialog({ snapshot, manifest, onClose, onRefreshLocal }: { snapshot: LocalResourceSnapshot; manifest?: KitManifest; onClose: () => void; onRefreshLocal?: () => void }) {
  return (
    <Modal title={manifest ? '编辑 Kit' : '新建 Kit'} onClose={onClose}>
      <KitEditorForm snapshot={snapshot} manifest={manifest} onSaved={onRefreshLocal} onClose={onClose} />
    </Modal>
  );
}

function KitDetail({
  item,
  manifest,
  snapshot,
  onSelectResource,
  onEdit,
  onExport,
  onInstall,
  onRemove,
  onDelete
}: {
  item: VisibleItem;
  manifest: KitManifest;
  snapshot: LocalResourceSnapshot;
  onSelectResource: (item: VisibleItem) => void;
  onEdit: () => void;
  onExport: () => void;
  onInstall: () => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const kitRows = rowsForKit(snapshot, manifest.kitId);
  const includedRows = rowsForKitResources(snapshot, manifest);
  const authShrinkRows = includedRows.filter((row) => row.binding?.authStatus === AuthStatuses.AUTH_REVOKED || row.binding?.authStatus === AuthStatuses.SECURITY_DELISTED);
  const hashAnomalies = kitHashAnomalies(manifest, snapshot);
  const applicationRows = kitRows.filter((row) => row.binding?.metadata?.managedByKitId === manifest.kitId || row.resource.type === LocalResourceTypes.KIT && row.binding?.kitId === manifest.kitId);
  const operationResults = kitOperationResults(snapshot, manifest.kitId);

  return (
    <aside className="kit-detail-drawer" aria-label={`${manifest.name}工具集详情`} data-testid={`kit-detail-${safeId(manifest.kitId)}`}>
      <header className="section-header">
        <div>
          <h2>{manifest.name}</h2>
          <span className="meta">{manifest.kitId} · {manifest.version} · {item.scopeLabel}</span>
        </div>
        <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
      </header>
      <p className="muted">{manifest.description || '暂无描述。'}</p>
      <div className="card-action-row kit-primary-actions">
        <Button tone="primary" onClick={onInstall}>安装到项目/智能体</Button>
        <Button onClick={onRemove}>从项目移除</Button>
        <Button onClick={onEdit}>编辑</Button>
        <Button onClick={onExport}>导出</Button>
        <Button tone="danger" onClick={onDelete}>删除</Button>
      </div>

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
          ) : <p className="muted">暂无可展示的资源变更结果。</p>}
        </section>

        <KitActionPanel manifest={manifest} applicationRows={applicationRows} />
      </div>
    </aside>
  );
}

type KitInstallStep = 'kit' | 'config' | 'preview' | 'install';

function KitInstallDialog({
  snapshot,
  manifests,
  onClose,
  onRefreshLocal
}: {
  snapshot: LocalResourceSnapshot;
  manifests: KitManifest[];
  onClose: () => void;
  onRefreshLocal?: () => void;
}) {
  const [step, setStep] = useState<KitInstallStep>('config');
  const [projectId, setProjectId] = useState(projectOptionsForKit(snapshot)[0] ?? '');
  const [agentIds, setAgentIds] = useState<string[]>(unique(manifests.flatMap((manifest) => manifest.supportedAgents)).slice(0, 1));
  const [customPath, setCustomPath] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [busy, setBusy] = useState(false);
  const projectOptions = projectOptionsForKit(snapshot);
  const agentOptions = unique([...manifests.flatMap((manifest) => manifest.supportedAgents), ...agentOptionsForKit(snapshot)]);
  const targets = kitInstallTargets({ agentIds, projectId, customPath });
  const conflicts = manifests.flatMap((manifest) => kitConflictPreview(snapshot, manifest));
  const install = async () => {
    if (targets.length === 0) {
      setMessage({ tone: 'error', text: '请选择项目、智能体或自定义目录后再安装。' });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    setStep('install');
    try {
      let success = 0;
      let failed = 0;
      for (const manifest of manifests) {
        for (const target of targets) {
          const result = await desktopApi.kit.apply({
            kitId: manifest.kitId,
            target,
            applicationId: applicationId.trim() || undefined
          }) as Phase3OperationResult;
          if (result.status === 'success' || result.status === 'partial_success' || result.status === 'dry_run') success += 1;
          else failed += 1;
        }
      }
      setMessage({ tone: failed > 0 ? 'warn' : 'success', text: `安装完成：${success} 个目标成功记录，${failed} 个目标失败。` });
      onRefreshLocal?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kit 安装失败' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={manifests.length > 1 ? '批量安装 Kit' : `安装 ${manifests[0]?.name ?? 'Kit'}`} onClose={onClose}>
      <div className="kit-install-steps" role="tablist" aria-label="Kit 安装步骤">
        {(['kit', 'config', 'preview', 'install'] as KitInstallStep[]).map((item) => (
          <button key={item} type="button" className={step === item ? 'active' : ''} onClick={() => setStep(item)}>
            {kitInstallStepLabel(item)}
          </button>
        ))}
      </div>
      <section className="panel">
        <h3>选择 Kit</h3>
        <div className="kit-editor-selected">
          {manifests.map((manifest) => <span key={manifest.kitId}>{manifest.name} · {manifest.resources.length} 资源</span>)}
        </div>
      </section>
      <section className="panel" data-testid="kit-install-config">
        <h3>安装配置</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <label>
            <span className="filter-label">项目</span>
            <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">不限定项目</option>
              {projectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span className="filter-label">自定义目录</span>
            <input className="input" value={customPath} onChange={(event) => setCustomPath(event.target.value)} />
          </label>
          <label>
            <span className="filter-label">应用 ID</span>
            <input className="input" value={applicationId} onChange={(event) => setApplicationId(event.target.value)} />
          </label>
        </div>
        <div className="kit-agent-picker" aria-label="智能体选择">
          {agentOptions.length === 0 ? <p className="muted">当前没有可选智能体；可使用项目或自定义目录安装。</p> : agentOptions.map((agentId) => (
            <label key={agentId}>
              <input
                type="checkbox"
                checked={agentIds.includes(agentId)}
                onChange={() => setAgentIds((current) => current.includes(agentId) ? current.filter((value) => value !== agentId) : [...current, agentId])}
              />
              {agentId}
            </label>
          ))}
        </div>
      </section>
      <KitConflictPreview conflicts={conflicts} targetCount={targets.length} />
      {message ? <p className="muted" role="status" style={messageStyle(message.tone)}>{message.text}</p> : null}
      <div className="card-action-row">
        <Button onClick={onClose}>取消</Button>
        <Button onClick={() => setStep('preview')}>查看冲突预览</Button>
        <Button tone="primary" disabled={busy || manifests.length === 0} onClick={install}>{busy ? '安装中' : '安装'}</Button>
      </div>
    </Modal>
  );
}

function KitConflictPreview({ conflicts, targetCount }: { conflicts: KitConflict[]; targetCount: number }) {
  return (
    <section className="panel" data-testid="kit-conflict-preview">
      <h3>冲突预览</h3>
      <p className="muted">将预览 {targetCount} 个目标；Hook / CLI / MCP stdio 仍保持静态，不会执行。</p>
      {conflicts.length === 0 ? <p className="success-text">未发现缺失资源、Hash 异常或授权收缩。</p> : (
        <table className="table compact-table">
          <tbody>
            {conflicts.map((conflict) => (
              <tr key={`${conflict.kind}:${conflict.refId}:${conflict.message}`}>
                <td>{conflict.kind}</td>
                <td>{conflict.refId}</td>
                <td>{conflict.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function KitRemoveDialog({ snapshot, manifest, onClose, onRefreshLocal }: { snapshot: LocalResourceSnapshot; manifest: KitManifest; onClose: () => void; onRefreshLocal?: () => void }) {
  const applications = kitApplications(snapshot, manifest);
  const [applicationId, setApplicationId] = useState(applications[0]?.applicationId ?? '');
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await desktopApi.kit.removeApplication({ kitId: manifest.kitId, applicationId: applicationId || undefined });
      setMessage(phase3OperationMessage(result, applicationId ? 'Kit 已从选定应用移除。' : 'Kit 托管应用已全部移除。'));
      onRefreshLocal?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kit 移除失败' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="从项目移除 Kit" onClose={onClose}>
      <section className="panel">
        <h3>已安装目标</h3>
        {applications.length === 0 ? <p className="muted">没有发现 Kit 托管应用记录。</p> : (
          <table className="table compact-table">
            <tbody>
              {applications.map((application) => (
                <tr key={application.applicationId}>
                  <td>{application.applicationId}</td>
                  <td>{application.targets.join(' / ') || '未记录目标'}</td>
                  <td>{application.count} 绑定</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <label>
        <span className="filter-label">应用 ID</span>
        <select className="input" value={applicationId} onChange={(event) => setApplicationId(event.target.value)}>
          <option value="">全部 Kit 托管应用</option>
          {applications.map((application) => <option key={application.applicationId} value={application.applicationId}>{application.applicationId}</option>)}
        </select>
      </label>
      <p className="muted">仅移除 Kit 托管绑定，不删除用户原始配置文件。</p>
      {message ? <p className="muted" role="status" style={messageStyle(message.tone)}>{message.text}</p> : null}
      <div className="card-action-row">
        <Button onClick={onClose}>取消</Button>
        <Button tone="danger" disabled={busy} onClick={remove}>{busy ? '移除中' : '移除'}</Button>
      </div>
    </Modal>
  );
}

function KitDeleteDialog({ snapshot, manifest, onClose, onRefreshLocal }: { snapshot: LocalResourceSnapshot; manifest: KitManifest; onClose: () => void; onRefreshLocal?: () => void }) {
  const [removeApplications, setRemoveApplications] = useState(false);
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [busy, setBusy] = useState(false);
  const applications = kitApplications(snapshot, manifest);
  const applicationBindingCount = applications.reduce((sum, application) => sum + application.count, 0);
  const deleteKit = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await desktopApi.kit.deleteManifest({ kitId: manifest.kitId, removeApplications });
      setMessage(phase3OperationMessage(result, removeApplications ? 'Kit 包和托管应用已删除。' : 'Kit 包记录已删除。'));
      onRefreshLocal?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kit 删除失败' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="删除 Kit" onClose={onClose}>
      <p className="muted">删除只针对 EnterpriseAgentHub 本地 Kit 包记录；用户原始 Skill/MCP/配置文件不会被删除。</p>
      <section className="panel kit-delete-targets" data-testid="kit-delete-targets">
        <h3>已安装目标</h3>
        {applications.length === 0 ? <p className="muted">没有发现 Kit 托管应用记录，可直接删除包记录。</p> : (
          <>
            <p className="muted">{applications.length} 个应用记录，{applicationBindingCount} 个 Kit 托管绑定。</p>
            <table className="table compact-table">
              <tbody>
                {applications.map((application) => (
                  <tr key={application.applicationId}>
                    <td>{application.applicationId}</td>
                    <td>{application.targets.join(' / ') || '未记录目标'}</td>
                    <td>{application.count} 绑定</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      {applications.length > 0 ? (
        <label className="kit-candidate-row">
          <input type="checkbox" checked={removeApplications} onChange={() => setRemoveApplications((value) => !value)} />
          <span>
            <strong>同时移除所有 Kit 托管应用</strong>
            <small>相当于 HarnessKit 的删除前卸载选项；未勾选时会阻止删除，避免留下悬挂应用记录。</small>
          </span>
        </label>
      ) : null}
      {message ? <p className="muted" role="status" style={messageStyle(message.tone)}>{message.text}</p> : null}
      <div className="card-action-row">
        <Button onClick={onClose}>取消</Button>
        <Button tone="danger" disabled={busy} onClick={deleteKit}>{busy ? '删除中' : '确认删除'}</Button>
      </div>
    </Modal>
  );
}

function KitExportDialog({ manifest, onClose, onRefreshLocal }: { manifest: KitManifest; onClose: () => void; onRefreshLocal?: () => void }) {
  const [targetPath, setTargetPath] = useState('');
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [busy, setBusy] = useState(false);
  const exportKit = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await desktopApi.kit.exportManifest({ kitId: manifest.kitId, targetPath: targetPath.trim() || undefined });
      setMessage(phase3OperationMessage(result, targetPath.trim() ? 'Kit manifest 已导出到指定路径。' : 'Kit manifest 数据已导出到操作结果。'));
      onRefreshLocal?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kit 导出失败' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="导出 Kit" onClose={onClose}>
      <label>
        <span className="filter-label">导出路径</span>
        <input className="input" value={targetPath} onChange={(event) => setTargetPath(event.target.value)} />
      </label>
      <p className="muted">留空时只返回 manifest 数据；填写路径时通过 LocalExecutor 写入并保留备份/回滚记录。</p>
      {message ? <p className="muted" role="status" style={messageStyle(message.tone)}>{message.text}</p> : null}
      <div className="card-action-row">
        <Button onClick={onClose}>取消</Button>
        <Button tone="primary" disabled={busy} onClick={exportKit}>{busy ? '导出中' : '导出'}</Button>
      </div>
    </Modal>
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
        <Button disabled={busy} onClick={() => run(() => desktopApi.kit.checkDrift({ kitId: manifest.kitId }), 'Kit 漂移检查已记录。')}>检查漂移</Button>
        <Button disabled={busy} onClick={() => run(() => desktopApi.kit.staticAudit({ kitId: manifest.kitId }), 'Kit 静态审计已记录。')}>静态审计</Button>
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
  const [targetAgentId, setTargetAgentId] = useState(initialIdentity.targetAgentId ?? '');
  const [displayName, setDisplayName] = useState(initialIdentity.displayName);
  const [rootPath, setRootPath] = useState(asStringArray(profile?.detectionRoots)[0] ?? '');
  const [rulesText, setRulesText] = useState(JSON.stringify(profile?.resourcePaths ?? {}, null, 2));
  const [message, setMessage] = useState<UiMessage | undefined>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const identity = customAgentProfileIdentity(agent, definition, settingsConfig.agentProfiles);
    setProfileId(identity.profileId);
    setAgentId(identity.agentId);
    setTargetAgentId(identity.targetAgentId ?? '');
    setDisplayName(identity.displayName);
    setRootPath(asStringArray(profile?.detectionRoots)[0] ?? '');
    setRulesText(JSON.stringify(profile?.resourcePaths ?? {}, null, 2));
  }, [agent.id, definition?.id, profile, settingsConfig.agentProfiles]);
  const validate = () => buildCustomAgentProfile({ profileId, agentId, targetAgentId, displayName, rootPath, rulesText });
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
        <input className="input" aria-label="Agent ID" value={agentId} readOnly={Boolean(targetAgentId)} onChange={(event) => setAgentId(event.target.value)} />
      </label>
      {targetAgentId ? (
        <label>
          <span className="filter-label">目标智能体</span>
          <input className="input" aria-label="目标智能体" value={targetAgentId} readOnly onChange={(event) => setTargetAgentId(event.target.value)} />
        </label>
      ) : null}
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
      {row ? <AuditFindingsPanel row={row} /> : null}
      {resource && isExtensionResource(resource.type) ? <ExtensionDetailSections item={item} rows={relatedRows} /> : null}
      <section className="panel">
        <h3>操作边界</h3>
        <p className="muted">当前提供真实扫描、预览、权限摘要和静态审计；写入需要 ExecutionPlan、备份和回滚链路，Hook / CLI / MCP stdio 或 command 均不会被启动。</p>
        <div className="card-action-row">
          <Button disabled title="需要 ExecutionPlan、备份和回滚接入">启用</Button>
          <Button disabled title="需要 ExecutionPlan、备份和回滚接入">停用</Button>
          <Button disabled={filePreview.busy || !canPreviewFile} title={selectedFile ? '真实读取小型文本文件并脱敏展示' : '没有可预览文件'} onClick={previewFile}>预览文件</Button>
          <Button disabled={pathCheck.busy || !canCheckPath} title={canCheckPath ? '真实读取路径状态并记录检查结果' : '没有可检查路径'} onClick={checkPath}>检查路径</Button>
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

export function AuditFindingDetailSection({ finding, row, onOpenResource }: { finding: AuditFindingRecord; row?: LocalResourceRow; onOpenResource?: () => void }) {
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
    </section>
  );
}

function AuditFindingsPanel({ row }: { row: LocalResourceRow }) {
  const findings = [...(row.findings ?? [])].sort(compareAuditFindingsByRisk);
  if (findings.length === 0) return null;
  return (
    <section className="panel" data-testid="local-audit-findings-panel">
      <h3>审计发现</h3>
      <table className="table compact-table">
        <tbody>
          {findings.slice(0, 8).map((finding) => (
            <tr key={finding.id}>
              <td>
                <strong>{finding.title}</strong>
                <div className="muted">规则 {finding.ruleId} / 风险 {finding.severity}</div>
              </td>
              <td>{finding.permissionCategory}</td>
              <td>{auditStatusLabel(finding.auditStatus)}</td>
              <td>{compactDate(finding.detectedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {findings.length > 8 ? <p className="muted">还有 {findings.length - 8} 条审计发现，已按风险优先折叠。</p> : null}
    </section>
  );
}

function ExtensionDetailSections({ item, rows }: { item: VisibleItem; rows: LocalResourceRow[] }) {
  const resource = item.row?.resource;
  const metadata = resource?.metadata ?? {};
  const agentIds = unique(rows.map((row) => row.binding?.agentId).filter((value): value is string => Boolean(value)));
  const projectIds = unique(rows.map((row) => row.binding?.projectId).filter((value): value is string => Boolean(value)));
  const authShrink = rows.some((row) => row.binding?.authStatus === AuthStatuses.AUTH_REVOKED || row.binding?.authStatus === AuthStatuses.SECURITY_DELISTED);
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
          <h3>Hook / CLI 边界</h3>
          <p className="muted">Hook 和 CLI 只进入配置管理、路径检查、权限摘要和静态审计体系，不展示运行时触发或调用记录。</p>
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

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <Button tone="ghost" onClick={onClose} aria-label="关闭">x</Button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </>
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
  return (snapshot.rows ?? [])
    .filter((row) => !nav.resourceTypes || nav.resourceTypes.includes(row.resource.type))
    .map(rowToItem);
}

function createExtensionItems(snapshot: LocalResourceSnapshot): VisibleItem[] {
  const groupedRows = extensionRowGroups((snapshot.rows ?? []).filter((row) => isExtensionResource(row.resource.type)));
  return groupedRows.map((rows) => {
    const base = preferredExtensionRow(rows);
    const resource = base.resource;
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

function extensionRowGroups(rows: LocalResourceRow[]): LocalResourceRow[][] {
  const groups = new Map<string, LocalResourceRow[]>();
  for (const row of rows) {
    const key = extensionCanonicalKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

function extensionCanonicalKey(row: LocalResourceRow): string {
  if (row.resource.type !== LocalResourceTypes.SKILL) return row.resource.id;
  const skillFile = firstText(
    row.binding?.metadata?.skillFile,
    row.resource.metadata.skillFile,
    row.files.find((file) => isSkillManifestPath(file.path))?.path,
    isSkillManifestPath(row.binding?.targetPath) ? row.binding?.targetPath : undefined,
    isSkillManifestPath(row.resource.sourcePath) ? row.resource.sourcePath : undefined
  );
  if (skillFile) return `skill:${normalizeLocalPath(skillFile)}`;
  const skillDirectory = firstText(row.binding?.metadata?.skillDirectory, row.resource.metadata.skillDirectory);
  if (skillDirectory) return `skill:${normalizeLocalPath(`${skillDirectory}/SKILL.md`)}`;
  return row.resource.id;
}

function preferredExtensionRow(rows: LocalResourceRow[]): LocalResourceRow {
  return [...rows].sort((left, right) => extensionRowRank(right) - extensionRowRank(left))[0] ?? rows[0];
}

function extensionRowRank(row: LocalResourceRow): number {
  if (row.resource.type !== LocalResourceTypes.SKILL) return 0;
  const targetPath = row.binding?.targetPath ?? row.resource.sourcePath;
  if (isSkillManifestPath(targetPath)) return 3;
  if (firstText(row.binding?.metadata?.skillFile, row.resource.metadata.skillFile)) return 2;
  if (!String(row.resource.sourceId ?? '').startsWith('codex.skill.')) return 1;
  return 0;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asText(value, '');
    if (text) return text;
  }
  return undefined;
}

function isSkillManifestPath(value: unknown): value is string {
  return typeof value === 'string' && /(^|[\\/])SKILL\.md$/i.test(value);
}

function normalizeLocalPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
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
    if (asText(row.resource.metadata.targetAgentId, '')) return [];
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
  return (snapshot.rows ?? []).filter((row) => rowTargetsAgent(row, agentId));
}

function rowTargetsAgent(row: LocalResourceRow, agentId: string): boolean {
  return row.binding?.agentId === agentId
    || row.resource.sourceId === agentId
    || String(row.resource.sourceId ?? '').startsWith(`${agentId}:`)
    || targetAgentIdForRow(row) === agentId;
}

function targetAgentIdForRow(row: LocalResourceRow): string | undefined {
  return asText(row.binding?.metadata?.targetAgentId ?? row.resource.metadata.targetAgentId, '') || undefined;
}

function isAgentExtensionType(type: LocalResourceType | string): boolean {
  return type === LocalResourceTypes.SKILL
    || type === LocalResourceTypes.MCP_SERVER
    || type === LocalResourceTypes.PLUGIN
    || type === LocalResourceTypes.HOOK
    || type === LocalResourceTypes.CLI_COMMAND;
}

function rowsForProject(snapshot: LocalResourceSnapshot, projectId: string): LocalResourceRow[] {
  return (snapshot.rows ?? []).filter((row) => row.binding?.projectId === projectId || (row.resource.type === LocalResourceTypes.PROJECT && row.resource.sourceId === projectId));
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

function rowForFinding(snapshot: LocalResourceSnapshot, finding: AuditFindingRecord): LocalResourceRow | undefined {
  return (snapshot.rows ?? []).find((row) => (
    row.resource.id === finding.resourceId
    && (!finding.bindingId || row.binding?.id === finding.bindingId)
  )) ?? (snapshot.rows ?? []).find((row) => row.resource.id === finding.resourceId);
}

function fileForItem(item: VisibleItem): FileBackedResource | undefined {
  if (!item.row) return undefined;
  if (item.path) {
    const exact = item.row.files.find((file) => file.path === item.path);
    if (exact) return exact;
  }
  return item.row.files[0];
}

function agentConfigEntriesForSection(rows: LocalResourceRow[], section: AgentConfigBrowserSection): AgentConfigEntry[] {
  return rows
    .filter((row) => section.resourceTypes.includes(row.resource.type))
    .flatMap((row) => {
      if (row.files.length > 0) return row.files.map((file) => agentConfigEntry(row, file));
      return [agentConfigEntry(row)];
    });
}

function agentConfigBrowserCounts(entries: AgentConfigEntry[]): { entryCount: number; fileCount: number } {
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.file) files.add(`${entry.file.bindingId}:${entry.file.path}`);
  }
  return {
    entryCount: entries.length,
    fileCount: files.size
  };
}

function agentConfigEntry(row: LocalResourceRow, file?: FileBackedResource): AgentConfigEntry {
  const path = file?.path ?? row.binding?.targetPath ?? row.resource.sourcePath;
  return {
    id: [row.resource.id, row.binding?.id ?? 'resource', file?.path ?? 'record'].join(':'),
    row,
    file,
    title: file ? fileBasename(file.path) : row.resource.displayName || row.resource.name,
    path
  };
}

function agentConfigEntryCanCheck(entry: AgentConfigEntry): boolean {
  return Boolean(agentConfigEntryBindingId(entry));
}

function agentConfigEntryCanPreview(entry: AgentConfigEntry): boolean {
  return Boolean(entry.file?.previewAvailable && agentConfigEntryBindingId(entry));
}

function agentConfigEntryBindingId(entry: AgentConfigEntry): string | undefined {
  return entry.row.binding?.id ?? entry.file?.bindingId;
}

export function agentConfigEntryPayload(entry: AgentConfigEntry): { resourceId?: string; bindingId?: string; targetPath?: string } {
  const bindingId = agentConfigEntryBindingId(entry);
  return {
    bindingId,
    resourceId: undefined,
    targetPath: entry.path
  };
}

function fileBasename(pathValue: string): string {
  return pathValue.split(/[\\/]/).pop() || pathValue;
}

function fileSizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function definitionForAgent(agentId: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((definition) => definition.id === agentId);
}

function rowToItem(row: LocalResourceRow): VisibleItem {
  const resource = row.resource;
  const binding = row.binding;
  const file = row.files[0];
  const targetAgentId = targetAgentIdForRow(row);
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
    agentId: targetAgentId ?? binding?.agentId,
    agentIds: unique([binding?.agentId, targetAgentId].filter((value): value is string => Boolean(value))),
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

function customAgentProfileIdentity(agent: VisibleItem, definition: AgentDefinition | undefined, existing: unknown): { profileId: string; agentId: string; targetAgentId?: string; displayName: string } {
  const resource = agent.row?.resource;
  const targetAgentId = definition?.builtIn ? definition.id : asText(resource?.metadata.targetAgentId, '');
  const rawAgentId = asText(agent.row?.binding?.agentId ?? resource?.sourceId ?? definition?.id, '');
  const fallbackAgentId = targetAgentId ? `custom-${targetAgentId}` : fallbackCustomAgentId(agent, definition);
  const rowAgentId = rawAgentId && rawAgentId !== CUSTOM_AGENT_ID ? rawAgentId : fallbackAgentId;
  const storedProfile = findConfiguredAgentProfile(existing, rowAgentId, targetAgentId);
  const storedAgentId = asText(storedProfile?.agentId, '');
  const agentId = storedAgentId && storedAgentId !== CUSTOM_AGENT_ID ? storedAgentId : rowAgentId;
  const fallbackDisplayName = targetAgentId && definition ? `${definition.label} 自定义路径` : asText(resource?.displayName ?? resource?.name ?? agent.name ?? definition?.label, '自定义目录');
  return {
    profileId: asText(storedProfile?.profileId ?? resource?.metadata.profileId, agentId),
    agentId,
    ...(targetAgentId ? { targetAgentId } : {}),
    displayName: asText(storedProfile?.displayName, fallbackDisplayName)
  };
}

function fallbackCustomAgentId(agent: VisibleItem, definition: AgentDefinition | undefined): string {
  const resource = agent.row?.resource;
  const base = normalizeCustomAgentId(asText(resource?.metadata.agentId ?? resource?.displayName ?? resource?.name ?? agent.name ?? definition?.label, 'local'));
  const candidate = base && base !== CUSTOM_AGENT_ID ? base : 'local';
  return candidate.startsWith('custom-') ? candidate : `custom-${candidate}`;
}

function findConfiguredAgentProfile(existing: unknown, agentId: string, targetAgentId?: string): Record<string, unknown> | undefined {
  if (!Array.isArray(existing)) return undefined;
  const normalizedTargetAgentId = targetAgentId ? normalizeCustomAgentId(targetAgentId) : '';
  return existing
    .map(asRecord)
    .find((item): item is Record<string, unknown> => {
      if (!item) return false;
      return asText(item.agentId, '') === agentId
        || asText(item.profileId, '') === agentId
        || Boolean(normalizedTargetAgentId && asText(item.targetAgentId, '') === normalizedTargetAgentId);
    });
}

export function upsertAgentProfile(existing: unknown, profile: Record<string, unknown>): Record<string, unknown>[] {
  const current = Array.isArray(existing)
    ? existing.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const profileId = asText(profile.profileId, '');
  const agentId = asText(profile.agentId, '');
  const targetAgentId = asText(profile.targetAgentId, '');
  let replaced = false;
  const next = current.map((item) => {
    if (
      (profileId && asText(item.profileId, '') === profileId)
      || (agentId && asText(item.agentId, '') === agentId)
      || (targetAgentId && asText(item.targetAgentId, '') === targetAgentId)
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
  targetAgentId?: string;
  displayName: string;
  rootPath: string;
  rulesText: string;
}

export function buildCustomAgentProfile(input: CustomAgentProfileDraft): { valid: true; profile: Record<string, unknown> } | { valid: false; error: string } {
  const profileId = normalizeCustomAgentId(input.profileId);
  const agentId = normalizeCustomAgentId(input.agentId);
  const targetAgentId = input.targetAgentId ? normalizeCustomAgentId(input.targetAgentId) : '';
  const root = input.rootPath.trim();
  if (!profileId) return { valid: false, error: 'Profile ID 不能为空，且只能包含字母、数字、点、下划线或连字符。' };
  if (!agentId) return { valid: false, error: 'Agent ID 不能为空，且只能包含字母、数字、点、下划线或连字符。' };
  if (BUILT_IN_AGENT_DEFINITIONS.some((definition) => definition.id === agentId)) return { valid: false, error: 'Agent ID 不能覆盖内置智能体。' };
  if (targetAgentId && !BUILT_IN_AGENT_DEFINITIONS.some((definition) => definition.id === targetAgentId)) return { valid: false, error: '目标智能体必须是内置智能体。' };
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
      ...(targetAgentId ? { targetAgentId } : {}),
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
  const resourceTypes = resourceTypesForAgentResourceKind(kind);
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
    item.kitId
  ].some((value) => String(value ?? '').toLowerCase().includes(needle));
}

function uniqueOptions(values: string[]): string[] {
  return ['全部', ...Array.from(new Set(values.filter(Boolean)))];
}

function orderedExtensionTypeOptions(values: string[]): string[] {
  const options = Array.from(new Set(values.filter(Boolean)));
  options.sort((left, right) => {
    const leftRank = extensionTypeRank(left);
    const rightRank = extensionTypeRank(right);
    return leftRank - rightRank || NAME_COLLATOR.compare(left, right);
  });
  return ['全部', ...options];
}

function extensionTypeRank(value: string): number {
  const rank = EXTENSION_TYPE_FILTER_ORDER.findIndex((option) => option.toLowerCase() === value.toLowerCase());
  return rank === -1 ? EXTENSION_TYPE_FILTER_ORDER.length : rank;
}

function compareVisibleItemsByName(left: VisibleItem, right: VisibleItem): number {
  return NAME_COLLATOR.compare(left.name, right.name)
    || NAME_COLLATOR.compare(left.typeLabel, right.typeLabel)
    || NAME_COLLATOR.compare(left.path ?? '', right.path ?? '')
    || NAME_COLLATOR.compare(left.id, right.id);
}

function resourceSubtext(item: VisibleItem): string {
  const parts = [
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
  if (snapshot.summary.failureCount > 0) return '当前筛选没有匹配项，扫描失败项可在审计中查看。';
  if (tab === 'overview') return '已完成本地扫描，未发现可展示资源。';
  return '没有符合当前页面和筛选条件的真实本地资源。';
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
