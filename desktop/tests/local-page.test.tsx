import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalPage } from '../src/renderer/pages/LocalPage';
import {
  aggregateResourceStatus,
  AuthStatuses,
  AuditStatuses,
  DetectionStatuses,
  DriftStatuses,
  LifecycleStatuses,
  LocalResourceSourceTypes,
  LocalResourceTypes,
  OperationStatuses,
  PathStatuses,
  ResourceScopeTypes,
  SyncStatuses,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  type LocalResourceSnapshot
} from '../src/shared/local-resources';
import type { LocalTab } from '../src/renderer/types/desktop';

describe('local resource page', () => {
  it('renders six phase-one navigation entries, unified fields, and disabled unfinished operations', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={snapshot()}
        activeTab="extensions"
        offline={false}
        localScanState="ready"
        localScanSummary={{
          scannedAt: '2026-06-15T00:00:00Z',
          discovered: { skills: 1, mcpConfigs: 0, plugins: 0, tools: 0, projects: 0, failures: 0, total: 1 }
        }}
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    for (const label of ['概览', '智能体', '扩展', '项目', '工具集', '审计与事件']) {
      expect(html).toContain(label);
    }
    for (const header of ['名称', '类型', '智能体/项目', '权限', '审计', '状态']) {
      expect(html).toContain(`<th>${header}</th>`);
    }
    expect(html).toContain('Weather Skill');
    expect(html).toContain('授权收缩');
    expect(html).toContain('未审计');
    expect(html).toContain('data-testid="local-detail-resource_skill_c2tpbGwud2VhdGhlcg-binding');
    expect(html).toContain('disabled=""');
    expect(html).toContain('阶段一仅建模');
    expect(html).not.toContain('SKILL_ENABLE');
    expect(html).not.toContain('shell-command');
  });

  it('renders real empty states for each new navigation entry', () => {
    for (const tab of ['overview', 'agents', 'extensions', 'projects', 'toolkits', 'audit-events'] as LocalTab[]) {
      const html = renderToStaticMarkup(
        <LocalPage
          snapshot={emptySnapshot()}
          activeTab={tab}
          offline={false}
          localScanState="ready"
          localScanSummary={{ scannedAt: '2026-06-15T00:00:00Z', discovered: { failures: 0, total: 0 } }}
          onChangeTab={() => undefined}
          onRefreshLocal={() => undefined}
        />
      );
      expect(html).toContain('暂无');
      expect(html).toContain(tab === 'overview' ? '未发现可展示资源' : '真实本地资源');
    }
  });

  it('surfaces scan failures and local events from real snapshot data', () => {
    const html = renderToStaticMarkup(
      <LocalPage
        snapshot={failureSnapshot()}
        activeTab="audit-events"
        offline
        localScanState="error"
        localScanError={{ message: '本地扫描失败', requestID: 'req-scan' }}
        onChangeTab={() => undefined}
        onRefreshLocal={() => undefined}
      />
    );

    expect(html).toContain('本地扫描失败');
    expect(html).toContain('req-scan');
    expect(html).toContain('无法解析本地资源配置');
    expect(html).toContain('失败');
    expect(html).toContain('CONFIG_SCAN_FAILED');
    expect(html).toContain('当前离线');
  });
});

function snapshot(): LocalResourceSnapshot {
  const generatedAt = '2026-06-15T00:00:00Z';
  const resource = {
    id: 'resource_skill_c2tpbGwud2VhdGhlcg',
    type: LocalResourceTypes.SKILL,
    name: 'Weather Skill',
    displayName: 'Weather Skill',
    sourceType: LocalResourceSourceTypes.CENTRAL_STORE,
    sourceId: 'skill.weather',
    sourcePath: '/tmp/central-store/skills/weather',
    version: '1.2.3',
    managed: true,
    centralStoreManaged: true,
    nativeDirectoryManaged: false,
    eaManagedFallback: false,
    permissionSummary: createEmptyPermissionSummary('未声明'),
    auditSummary: createNotAuditedSummary(),
    createdAt: generatedAt,
    lastScannedAt: generatedAt,
    metadata: { source: 'local_inventory_scan' }
  };
  const binding = {
    id: 'binding_resource_skill_c2tpbGwud2VhdGhlcg_scope',
    resourceId: resource.id,
    resourceType: LocalResourceTypes.SKILL,
    agentId: 'codex',
    scopeType: ResourceScopeTypes.AGENT_GLOBAL,
    targetPath: '/Users/alice/.codex/skills/weather',
    managedMode: 'SERVER_MANAGED' as const,
    writeMode: 'READ_ONLY' as const,
    detectionStatus: DetectionStatuses.DETECTED,
    lifecycleStatus: LifecycleStatuses.ENABLED,
    pathStatus: PathStatuses.OK,
    authStatus: AuthStatuses.AUTH_REVOKED,
    auditStatus: AuditStatuses.NOT_AUDITED,
    driftStatus: DriftStatuses.UNKNOWN,
    operationStatus: OperationStatuses.IDLE,
    syncStatus: SyncStatuses.LOCAL_ONLY,
    externalModified: false,
    drifted: false,
    metadata: {},
    updatedAt: generatedAt
  };
  const row = {
    resource,
    binding,
    files: [],
    events: [],
    status: aggregateResourceStatus(binding),
    scopeLabel: 'codex / 智能体全局'
  };
  return {
    resources: [resource],
    bindings: [binding],
    files: [],
    events: [],
    rows: [row],
    summary: { resourceCount: 1, bindingCount: 1, fileCount: 0, eventCount: 0, pendingSyncEvents: 0, failureCount: 0, lastScannedAt: generatedAt, generatedAt }
  };
}

function failureSnapshot(): LocalResourceSnapshot {
  const base = snapshot();
  const generatedAt = '2026-06-15T00:00:00Z';
  const resource = {
    ...base.resources[0],
    id: 'resource_skill_broken',
    name: '扫描失败：manifest.json',
    displayName: '扫描失败：manifest.json',
    sourceId: 'scan-failure',
    sourcePath: '/tmp/central-store/skills/broken/manifest.json',
    version: undefined,
    managed: false,
    centralStoreManaged: false
  };
  const binding = {
    ...base.bindings[0],
    id: 'binding_broken',
    resourceId: resource.id,
    detectionStatus: DetectionStatuses.SCAN_FAILED,
    lifecycleStatus: LifecycleStatuses.UNKNOWN,
    pathStatus: PathStatuses.UNKNOWN,
    authStatus: AuthStatuses.UNKNOWN,
    operationStatus: OperationStatuses.FAILURE,
    targetPath: '/tmp/central-store/skills/broken/manifest.json'
  };
  const event = {
    eventId: 'event-broken',
    idempotencyKey: 'local:broken',
    eventType: 'CONFIG_SCAN_FAILED',
    resourceId: resource.id,
    bindingId: binding.id,
    resourceType: LocalResourceTypes.SKILL,
    status: 'failure' as const,
    message: '无法解析本地资源配置',
    errorCode: 'manifest_parse_failed',
    failureReason: '无法解析本地资源配置',
    suggestion: '修复本地配置文件后重新扫描。',
    offlineCreated: true,
    syncStatus: SyncStatuses.LOCAL_ONLY,
    createdAt: generatedAt,
    metadata: {}
  };
  return {
    resources: [resource],
    bindings: [binding],
    files: [],
    events: [event],
    rows: [{ resource, binding, files: [], events: [event], status: aggregateResourceStatus(binding), scopeLabel: '自定义路径' }],
    summary: { resourceCount: 1, bindingCount: 1, fileCount: 0, eventCount: 1, pendingSyncEvents: 0, failureCount: 1, generatedAt }
  };
}

function emptySnapshot(): LocalResourceSnapshot {
  return {
    resources: [],
    bindings: [],
    files: [],
    events: [],
    rows: [],
    summary: { resourceCount: 0, bindingCount: 0, fileCount: 0, eventCount: 0, pendingSyncEvents: 0, failureCount: 0, generatedAt: '2026-06-15T00:00:00Z' }
  };
}
