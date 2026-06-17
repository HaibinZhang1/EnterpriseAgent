import { describe, expect, it } from 'vitest';
import {
  aggregateResourceStatus,
  AuditStatuses,
  AuthStatuses,
  DetectionStatuses,
  DriftStatuses,
  LifecycleStatuses,
  LocalEventTypes,
  LocalResourceTypes,
  OperationStatuses,
  PathStatuses,
  PermissionCategories,
  PermissionItems,
  SyncStatuses,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  extractKitManifest,
  isKitManifest,
  localResourceTypeLabel
} from '../src/shared/local-resources';

describe('local resource model', () => {
  it('defines phase-one resource, permission, audit, and event enums', () => {
    expect(LocalResourceTypes).toMatchObject({
      SKILL: 'SKILL',
      MCP_SERVER: 'MCP_SERVER',
      PLUGIN: 'PLUGIN',
      HOOK: 'HOOK',
      CLI_COMMAND: 'CLI_COMMAND',
      KIT: 'KIT',
      LOCAL_EVENT: 'LOCAL_EVENT'
    });
    expect(PermissionCategories.SHELL).toBe('SHELL');
    expect(PermissionItems.SHELL_COMMAND).toBe('SHELL_COMMAND');
    expect(LocalEventTypes.CONFIG_SCAN_FAILED).toBe('CONFIG_SCAN_FAILED');
    expect(localResourceTypeLabel(LocalResourceTypes.CLI_COMMAND)).toBe('CLI');
  });

  it('keeps unscanned and unaudited states explicit', () => {
    expect(createEmptyPermissionSummary()).toMatchObject({ label: '未声明', declared: false, categories: [] });
    expect(createNotAuditedSummary()).toMatchObject({ status: AuditStatuses.NOT_AUDITED, findingCount: 0 });
    expect(aggregateResourceStatus({ detectionStatus: DetectionStatuses.NOT_DETECTED, auditStatus: AuditStatuses.NOT_AUDITED }).label).toBe('未检测');
  });

  it('prioritizes security, failure, path, drift, sync, scan, then lifecycle status', () => {
    expect(aggregateResourceStatus({
      authStatus: AuthStatuses.SECURITY_DELISTED,
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('安全下架');
    expect(aggregateResourceStatus({
      operationStatus: OperationStatuses.FAILURE,
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('操作失败');
    expect(aggregateResourceStatus({
      auditStatus: AuditStatuses.HIGH_RISK,
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('高风险');
    expect(aggregateResourceStatus({
      pathStatus: PathStatuses.MISSING,
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('路径异常');
    expect(aggregateResourceStatus({
      driftStatus: DriftStatuses.HASH_CHANGED,
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('配置漂移');
    expect(aggregateResourceStatus({
      syncStatus: SyncStatuses.SYNC_FAILED,
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('同步失败');
    expect(aggregateResourceStatus({
      detectionStatus: DetectionStatuses.SCAN_FAILED,
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('扫描失败');
    expect(aggregateResourceStatus({
      lifecycleStatus: LifecycleStatuses.ENABLED
    }).label).toBe('已启用');
  });

  it('validates explicit Kit manifests and rejects legacy tool metadata', () => {
    const manifest = {
      kitId: 'kit.phase3',
      name: 'Phase 3 Kit',
      version: '1.0.0',
      sourceType: 'local',
      createdAt: '2026-06-16T00:00:00.000Z',
      supportedAgents: ['codex'],
      supportedPlatforms: ['macos', 'windows'],
      resources: [{
        refId: 'rule.default',
        resourceType: LocalResourceTypes.RULE,
        resourceId: 'resource_rule_default',
        required: true,
        metadata: {}
      }],
      permissionSummary: createEmptyPermissionSummary('Kit 权限'),
      auditSummary: createNotAuditedSummary('Kit 未审计'),
      requiredAuthorizations: [],
      resourceHashes: { 'rule.default': 'sha256:abc' },
      dependencies: [],
      conflictPolicy: 'skip',
      rollbackPolicy: 'best-effort',
      metadata: {}
    };

    expect(isKitManifest(manifest)).toBe(true);
    expect(extractKitManifest({ kitManifest: manifest })).toMatchObject({ kitId: 'kit.phase3' });
    expect(extractKitManifest({ manifest })).toMatchObject({ kitId: 'kit.phase3' });
    expect(isKitManifest({ ...manifest, resources: [{ refId: 'bad', resourceType: 'PROJECT', required: true, metadata: {} }] })).toBe(false);
    expect(isKitManifest({ ...manifest, rollbackPolicy: 'all-or-nothing' })).toBe(false);
    expect(extractKitManifest({ toolName: 'Codex', legacyTable: 'local_tools' })).toBeUndefined();
  });
});
