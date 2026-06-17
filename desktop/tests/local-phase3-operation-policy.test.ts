import { describe, expect, it } from 'vitest';
import {
  aggregateResourceChangeStatus,
  createPhase3OperationPolicyDecision,
  PHASE3_ACTION_REGISTRY,
  PHASE4_LOCAL_OPERATION_COVERAGE,
  summarizeCliVersion
} from '../src/shared/local-phase3-operations';
import { AuthStatuses, DriftStatuses, LocalResourceTypes, ManagedModes } from '../src/shared/local-resources';

describe('phase 3 operation policy', () => {
  it('blocks authorization-shrunk extension writes and keeps cleanup/static actions available', () => {
    const resource = {
      resourceId: 'resource_skill_alpha',
      bindingId: 'binding_skill_alpha_codex',
      resourceType: LocalResourceTypes.SKILL,
      authStatus: AuthStatuses.AUTH_REVOKED,
      name: 'Alpha Skill'
    };

    const install = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'skill.install',
      resources: [resource]
    });
    expect(install.status).toBe('blocked');
    expect(install.reason).toContain('授权收缩');

    const uninstall = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'skill.uninstall',
      resources: [resource]
    });
    expect(uninstall.status).toBe('allowed');
    expect(uninstall.backupRequirement).toBe('required');

    const audit = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'skill.static-audit',
      resources: [resource]
    });
    expect(audit.status).toBe('read_only');
    expect(audit.staticOnly).toBe(true);
  });

  it('keeps native Hook and CLI static-only while inheriting server-managed Kit authorization shrink', () => {
    const nativeCli = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'cli.enable',
      resources: [{
        resourceType: LocalResourceTypes.CLI_COMMAND,
        authStatus: AuthStatuses.AUTH_REVOKED,
        managedMode: ManagedModes.NATIVE_MANAGED,
        metadata: {}
      }]
    });
    expect(nativeCli.status).toBe('allowed');
    expect(nativeCli.staticOnly).toBe(true);

    const kitApply = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.apply',
      resources: [{
        resourceId: 'resource_cli_managed',
        resourceType: LocalResourceTypes.CLI_COMMAND,
        authStatus: AuthStatuses.AUTH_REVOKED,
        metadata: { managedByKitId: 'kit.secure' }
      }]
    });
    expect(kitApply.status).toBe('blocked');
    expect(kitApply.requiredAuthorizations).toHaveLength(1);
  });

  it('blocks Kit apply when required resource authorization is unknown', () => {
    const kitApply = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.apply',
      resources: [{
        resourceId: 'resource_skill_unknown',
        resourceType: LocalResourceTypes.SKILL,
        authStatus: AuthStatuses.UNKNOWN,
        metadata: { managedByKitId: 'kit.secure' }
      }]
    });

    expect(kitApply.status).toBe('blocked');
    expect(kitApply.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'authorization-not-verified',
        status: 'block',
        errorCode: 'authorization_not_verified'
      })
    ]));
    expect(kitApply.requiredAuthorizations).toEqual([
      expect.objectContaining({
        resourceId: 'resource_skill_unknown',
        requiredStatus: AuthStatuses.AUTH_CACHE_VALID
      })
    ]);
  });

  it('blocks hash drift before writes but keeps managed cleanup explicit', () => {
    const resource = {
      resourceId: 'resource_plugin_drifted',
      resourceType: LocalResourceTypes.PLUGIN,
      authStatus: AuthStatuses.AUTH_CACHE_VALID,
      driftStatus: DriftStatuses.HASH_CHANGED,
      expectedHash: 'expected',
      currentHash: 'actual'
    };

    const update = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'plugin.update',
      resources: [resource]
    });
    expect(update.status).toBe('blocked');
    expect(update.checks.map((check) => check.id)).toContain('hash-or-drift');

    const cleanup = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'plugin.uninstall',
      resources: [resource]
    });
    expect(cleanup.status).toBe('allowed');
    expect(cleanup.checks.find((check) => check.id === 'hash-or-drift-warning')?.status).toBe('warn');
  });

  it('disables MCP stdio/command connection tests and permits HTTP/SSE policy checks', () => {
    const command = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'mcp.connection-test',
      resources: [{ resourceType: LocalResourceTypes.MCP_SERVER, authStatus: AuthStatuses.AUTH_CACHE_VALID }],
      metadata: { connectionTestType: 'LOCAL_COMMAND' }
    });
    expect(command.status).toBe('disabled');
    expect(command.reason).toContain('不能通过启动本地进程');

    const http = createPhase3OperationPolicyDecision({
      surface: 'extensions',
      operation: 'mcp.connection-test',
      resources: [{ resourceType: LocalResourceTypes.MCP_SERVER, authStatus: AuthStatuses.AUTH_CACHE_VALID }],
      metadata: { connectionTestType: 'HTTP_HEALTH' }
    });
    expect(http.status).toBe('allowed');
    expect(http.checks.find((check) => check.id === 'mcp-network-connection-test')?.status).toBe('pass');
  });

  it('summarizes CLI version without executing a command and aggregates partial Kit results', () => {
    expect(summarizeCliVersion({ metadata: { manifestVersion: '1.2.3' } })).toMatchObject({ version: '1.2.3', source: 'manifest' });
    const unknown = summarizeCliVersion({ metadata: {} });
    expect(unknown.label).toBe('版本未知');
    expect(unknown.reason).toContain('不会执行 CLI');

    expect(aggregateResourceChangeStatus([
      { status: 'success', message: 'skill applied' },
      { status: 'failure', message: 'mcp failed', failureReason: 'hash mismatch' }
    ])).toBe('partial_success');
    expect(aggregateResourceChangeStatus([])).toBe('failure');
    expect(aggregateResourceChangeStatus([], 'success')).toBe('failure');
    expect(aggregateResourceChangeStatus([], 'dry_run')).toBe('dry_run');
  });

  it('keeps phase-four offline operations local/static and blocks server-authority operations while offline', () => {
    for (const operation of ['settings.update', 'rules.update', 'memory.update', 'subagents.update', 'ignore.update']) {
      const decision = createPhase3OperationPolicyDecision({
        surface: 'extensions',
        operation,
        offline: true,
        resources: [{ resourceType: LocalResourceTypes.AGENT_CONFIG }]
      });
      expect(decision.status, operation).toBe('allowed');
      expect(decision.offlineAvailable, operation).toBe(true);
      expect(decision.requiresHash, operation).toBe(true);
      expect(decision.backupRequirement, operation).toBe('required');
      expect(decision.rollbackSupported, operation).toBe(true);
    }

    for (const operation of ['hook.register', 'hook.enable', 'hook.disable', 'cli.register', 'cli.enable', 'cli.disable']) {
      const decision = createPhase3OperationPolicyDecision({
        surface: 'extensions',
        operation,
        offline: true,
        resources: [{ resourceType: operation.startsWith('hook.') ? LocalResourceTypes.HOOK : LocalResourceTypes.CLI_COMMAND }]
      });
      expect(decision.status, operation).toBe('allowed');
      expect(decision.staticOnly, operation).toBe(true);
      expect(decision.offlineAvailable, operation).toBe(true);
      expect(decision.checks.find((check) => check.id === 'static-only')?.message).toContain('不执行本地命令');
    }

    const updateCheck = createPhase3OperationPolicyDecision({
      surface: 'toolkits',
      operation: 'kit.check-update',
      offline: true,
      resources: [{ resourceType: LocalResourceTypes.KIT }]
    });
    expect(updateCheck.status).toBe('blocked');
    expect(updateCheck.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'offline-boundary', errorCode: 'offline_server_authority_required' })
    ]));
  });

  it('explicitly covers every phase-four LocalOperation alias without falling back to inferred server policy', () => {
    expect(PHASE4_LOCAL_OPERATION_COVERAGE.map((item) => item.localOperation)).toEqual([
      'SETTINGS_UPDATE',
      'SETTINGS_RESTORE',
      'RULE_ENABLE',
      'RULE_DISABLE',
      'RULE_UPDATE',
      'MEMORY_UPDATE',
      'MEMORY_RESTORE',
      'SUBAGENT_ENABLE',
      'SUBAGENT_DISABLE',
      'SUBAGENT_UPDATE',
      'IGNORE_UPDATE',
      'SKILL_INSTALL',
      'SKILL_ENABLE',
      'SKILL_DISABLE',
      'SKILL_UPDATE',
      'SKILL_UNINSTALL',
      'MCP_CONFIG_WRITE',
      'MCP_CONFIG_UPDATE',
      'MCP_CONFIG_DISABLE',
      'MCP_CONFIG_UNINSTALL',
      'PLUGIN_INSTALL',
      'PLUGIN_ENABLE',
      'PLUGIN_DISABLE',
      'PLUGIN_UPDATE',
      'PLUGIN_UNINSTALL',
      'HOOK_REGISTER',
      'HOOK_ENABLE',
      'HOOK_DISABLE',
      'HOOK_UPDATE',
      'CLI_REGISTER',
      'CLI_ENABLE',
      'CLI_DISABLE',
      'CLI_UPDATE',
      'KIT_APPLY',
      'KIT_REMOVE',
      'PROJECT_REGISTER',
      'PROJECT_UPDATE_PATH',
      'PROJECT_REMOVE_RECORD',
      'CUSTOM_AGENT_PROFILE_CREATE',
      'CUSTOM_AGENT_PROFILE_UPDATE'
    ]);

    for (const item of PHASE4_LOCAL_OPERATION_COVERAGE) {
      expect(PHASE3_ACTION_REGISTRY[item.operation], item.localOperation).toBeDefined();
      const decision = createPhase3OperationPolicyDecision({
        surface: item.surface,
        operation: item.operation,
        offline: true,
        resources: [{
          resourceId: `resource_${item.localOperation.toLowerCase()}`,
          resourceType: item.resourceType,
          authStatus: AuthStatuses.AUTH_CACHE_VALID,
          serverManaged: item.requiresAuthorization
        }]
      });
      expect(decision.offlineAvailable, item.localOperation).toBe(item.offlineAvailable);
      expect(decision.requiresHash, item.localOperation).toBe(item.requiresHash);
      expect(decision.backupRequirement, item.localOperation).toBe(item.backupRequirement);
      expect(decision.rollbackSupported, item.localOperation).toBe(item.rollbackSupported);
      expect(decision.staticOnly, item.localOperation).toBe(item.staticOnly);
      if (item.offlineAvailable) {
        expect(decision.checks.some((check) => check.id === 'offline-boundary'), item.localOperation).toBe(false);
      } else {
        expect(decision.checks).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'offline-boundary', status: 'block' })
        ]));
      }
      if (item.requiresAuthorization) {
        expect(decision.requiredAuthorizations.length, item.localOperation).toBeGreaterThan(0);
      } else {
        expect(decision.requiredAuthorizations, item.localOperation).toHaveLength(0);
      }
    }
  });
});
