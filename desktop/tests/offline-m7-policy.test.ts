import { describe, expect, it } from 'vitest';
import { OfflinePolicy } from '../src/main/cache/offline-policy';

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
});
