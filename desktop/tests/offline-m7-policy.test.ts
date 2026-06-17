import { describe, expect, it } from 'vitest';
import { OfflinePolicy, type OfflineOperation } from '../src/main/cache/offline-policy';

describe('M7 offline policy', () => {
  it('allows only documented local operations and cached Skill enablement while offline', () => {
    const policy = new OfflinePolicy();
    expect(policy.decide('local.viewInstalled', false).allowed).toBe(true);
    expect(policy.decide('local.disable.entry', false).allowed).toBe(true);
    expect(policy.decide('local.uninstall.entry', false).allowed).toBe(true);
    expect(policy.decide('extension.install', false).allowed).toBe(false);
    expect(policy.decide('extension.download', false).allowed).toBe(false);
    expect(policy.decide('mcp.config.write', false).allowed).toBe(false);
    expect(policy.decide('plugin.install', false).allowed).toBe(false);
    expect(policy.decideSkillEnableInstalled({ installed: true, hasValidAuthorizationCache: true, scopesMatch: true }, false).allowed).toBe(true);
    expect(policy.decideSkillEnableInstalled({ installed: true, hasValidAuthorizationCache: false, scopesMatch: true }, false).allowed).toBe(false);
    expect(policy.decideSkillEnableInstalled({ installed: true, hasValidAuthorizationCache: true, scopesMatch: true, scopeReduced: true }, false).allowed).toBe(false);
    expect(policy.decideSkillEnableInstalled({ installed: true, hasValidAuthorizationCache: true, scopesMatch: true, delisted: true }, false).allowed).toBe(false);
    expect(policy.decideSkillEnableInstalled({ installed: true, hasValidAuthorizationCache: true, scopesMatch: true, securityRisk: true }, false).allowed).toBe(false);
  });

  it('implements the phase-four offline-first matrix without granting server-authority operations', () => {
    const policy = new OfflinePolicy();
    const allowed: OfflineOperation[] = [
      'local.scan.agents',
      'local.scan.custom-directory',
      'local.scan.settings',
      'local.scan.rules',
      'local.scan.memory',
      'local.scan.subagents',
      'local.scan.ignore',
      'local.scan.hook',
      'local.scan.cli',
      'local.cached.skill.view',
      'local.cached.mcp.view',
      'local.cached.plugin.view',
      'local.file.preview',
      'local.static-audit',
      'local.path-check',
      'local.drift-check',
      'local.settings.write',
      'local.rules.write',
      'local.memory.write',
      'local.subagents.write',
      'local.ignore.write',
      'hook.config.enable',
      'hook.config.disable',
      'cli.config.register',
      'cli.config.enable',
      'cli.config.disable',
      'kit.local.import',
      'kit.local.audit',
      'kit.local.preview',
      'local.resource.apply-existing',
      'local.resource.disable',
      'local.resource.uninstall',
      'local.resource.cleanup'
    ];
    for (const operation of allowed) {
      expect(policy.decide(operation, false), operation).toMatchObject({ allowed: true });
    }

    const blocked: OfflineOperation[] = [
      'skill.install.new',
      'mcp.server.new',
      'plugin.download.new',
      'plugin.install.new',
      'mcp.server.copy-config',
      'update.check',
      'update.download',
      'authorization.refresh',
      'event.sync'
    ];
    for (const operation of blocked) {
      expect(policy.decide(operation, false, 'req_offline'), operation).toMatchObject({
        allowed: false,
        error: { code: 'offline_server_authority_required', requestID: 'req_offline' }
      });
    }
  });

  it('allows offline apply only for existing local resources with valid cached authority and clean integrity state', () => {
    const policy = new OfflinePolicy();
    expect(policy.decideApplyExistingLocalResource({
      presentOnDisk: true,
      hasValidAuthorizationCache: true,
      scopesMatch: true
    }, false)).toMatchObject({ allowed: true, reason: 'offline_existing_resource_with_valid_cache' });
    expect(policy.decideApplyExistingLocalResource({
      presentOnDisk: true,
      hasValidAuthorizationCache: true,
      scopesMatch: true,
      hashMismatch: true
    }, false)).toMatchObject({ allowed: false, error: { code: 'offline_authorization_required' } });
  });
});
