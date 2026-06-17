import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_AGENT_IDS,
  CUSTOM_AGENT_ID,
  buildCustomAgentManifest,
  getAgentManifest,
  listAgentCatalog,
  listBuiltInAgentManifests,
  normalizeCustomAgentProfiles,
  resolveAgentPathProfile,
  validateCustomAgentProfile
} from '../src/main/agents/agent-catalog';
import { createDryRunAdapters } from '../src/main/tool-adapters/builtin';

describe('phase 2 agent catalog and path profiles', () => {
  const forbiddenMarkers = ['TO' + 'DO', 'place' + 'holder'];

  it('defines the nine built-in agents and custom directory profile entry', () => {
    expect(BUILT_IN_AGENT_IDS).toEqual([
      'claude-code',
      'codex',
      'gemini-cli',
      'cursor',
      'antigravity',
      'copilot',
      'windsurf',
      'opencode',
      'hermes'
    ]);
    const catalog = listAgentCatalog();
    expect(catalog.map((agent) => agent.agentId)).toEqual([...BUILT_IN_AGENT_IDS, CUSTOM_AGENT_ID]);
    expect(catalog.map((agent) => agent.displayName)).toEqual(expect.arrayContaining([
      'Claude Code',
      'Codex',
      'Gemini CLI',
      'Cursor',
      'Antigravity',
      'Copilot',
      'Windsurf',
      'OpenCode',
      'Hermes',
      '自定义目录'
    ]));
  });

  it('gives every built-in a real macOS and Windows path profile with explicit capability states', () => {
    for (const manifest of listBuiltInAgentManifests()) {
      expect(manifest.supportedPlatforms, `${manifest.agentId} platforms`).toEqual(expect.arrayContaining(['macos', 'windows']));
      expect(manifest.defaultWriteMode, `${manifest.agentId} controlled write mode`).toBe('execution-plan-required');
      expect(manifest.capabilities, `${manifest.agentId} capabilities`).toEqual(expect.arrayContaining([
        'detect',
        'file-preview',
        'static-audit',
        'backup',
        'rollback'
      ]));
      expect(manifest.macosPathProfile?.detectionRoots.length, `${manifest.agentId} macOS roots`).toBeGreaterThan(0);
      expect(manifest.windowsPathProfile?.detectionRoots.length, `${manifest.agentId} Windows roots`).toBeGreaterThan(0);
      expect(manifest.macosPathProfile?.fallbackRoot).toContain(`/${manifest.agentId}/`);
      expect(manifest.windowsPathProfile?.fallbackRoot).toContain(`\\${manifest.agentId}\\`);
      for (const profile of [manifest.macosPathProfile, manifest.windowsPathProfile]) {
        expect(profile?.sourceLevels?.length).toBeGreaterThan(0);
        expect(Object.keys(profile?.capabilityStatus ?? {})).toEqual(expect.arrayContaining(['settings', 'rules', 'hooks', 'cli']));
        expect(profile?.resourcePaths?.files?.length, `${manifest.agentId} ${profile?.platform} preview paths`).toBeGreaterThan(0);
        expect(profile?.capabilityStatus?.files, `${manifest.agentId} ${profile?.platform} file preview`).toBe('SUPPORTED');
        for (const marker of forbiddenMarkers) expect(JSON.stringify(profile)).not.toContain(marker);
      }
    }
  });

  it('resolves platform variables, user overrides, project roots, and EA fallback paths without shelling out', () => {
    const codex = getAgentManifest('codex')!;
    const resolvedCodex = resolveAgentPathProfile(codex.macosPathProfile!, {
      platform: 'macos',
      homeDir: '/Users/alice',
      projectRoot: '/repo/app',
      env: { CODEX_HOME: '/opt/codex-home' }
    });
    expect(resolvedCodex.detectionRoots).toContain('/opt/codex-home');
    expect(resolvedCodex.globalResourcePaths).toContain('/opt/codex-home/config.toml');
    expect(resolvedCodex.projectResourcePaths).toContain('/repo/app/AGENTS.md');
    expect(resolvedCodex.fallbackRoot).toBe('/Users/alice/.enterprise-agent/local/codex/');

    const claude = getAgentManifest('claude-code')!;
    const resolvedWindows = resolveAgentPathProfile(claude.windowsPathProfile!, {
      platform: 'windows',
      homeDir: 'C:\\Users\\Alice',
      userProfileDir: 'C:\\Users\\Alice',
      projectRoot: 'D:\\repo\\app',
      env: { CLAUDE_CONFIG_DIR: 'D:\\ClaudeHome' }
    });
    expect(resolvedWindows.detectionRoots).toContain('D:\\ClaudeHome');
    expect(resolvedWindows.globalResourcePaths).toContain('D:\\ClaudeHome\\settings.json');
    expect(resolvedWindows.projectResourcePaths).toContain('D:\\repo\\app\\.mcp.json');
  });

  it('keeps project-scoped paths unresolved until a concrete project root exists', () => {
    const cursor = getAgentManifest('cursor')!;
    const resolved = resolveAgentPathProfile(cursor.macosPathProfile!, {
      platform: 'macos',
      homeDir: '/Users/alice',
      env: {}
    });
    expect(resolved.detectionRoots).toContain('<project>/.cursor');
    expect(resolved.projectResourcePaths).toContain('<project>/.cursor/rules/*.mdc');
  });

  it('validates custom Agent Profiles before they can behave like built-ins', () => {
    expect(validateCustomAgentProfile({ agentId: 'codex', displayName: 'Codex Clone', supportedPlatforms: ['macos'], rootPaths: ['/tmp/codex'] }).errors).toContain('agentId codex already exists');
    const invalidTargetProfile = { agentId: 'custom-codex', targetAgentId: 'unknown-agent', displayName: 'Codex Paths', supportedPlatforms: ['macos'], rootPaths: ['/tmp/codex'], pathProfile: customPathProfile('/tmp/codex') } as unknown as Parameters<typeof validateCustomAgentProfile>[0];
    expect(validateCustomAgentProfile(invalidTargetProfile).errors).toContain('targetAgentId unknown-agent must reference a built-in agent');
    expect(validateCustomAgentProfile({ agentId: 'new-agent', displayName: 'New Agent', supportedPlatforms: ['macos'], rootPaths: [] }).errors).toContain('at least one root path is required');
    expect(validateCustomAgentProfile({ profileId: CUSTOM_AGENT_ID, agentId: CUSTOM_AGENT_ID, displayName: 'Reserved', supportedPlatforms: ['macos'], rootPaths: ['/tmp/custom'], pathProfile: customPathProfile('/tmp/custom') }).errors).toEqual(expect.arrayContaining([
      `agentId ${CUSTOM_AGENT_ID} is reserved for the custom profile template`,
      `profileId ${CUSTOM_AGENT_ID} is reserved for the custom profile template`
    ]));
    const profile = validateCustomAgentProfile({
      profileId: 'custom-new-agent',
      agentId: 'custom-new-agent',
      displayName: 'New Agent',
      supportedPlatforms: ['macos', 'windows'],
      rootPaths: ['/Users/alice/.new-agent'],
      createdByUser: true,
      capabilities: ['detect', 'global-scope', 'project-scope', 'settings-read', 'static-audit'],
      pathProfile: {
        platform: 'macos',
        detectionRoots: ['/Users/alice/.new-agent'],
        globalResourcePaths: ['/Users/alice/.new-agent/settings.json'],
        projectResourcePaths: ['<project>/.new-agent/rules/*.md'],
        sourceLevel: 'USER_CONFIG_REQUIRED',
        resourcePaths: {
          settings: ['/Users/alice/.new-agent/settings.json'],
          rules: ['<project>/.new-agent/rules/*.md']
        }
      }
    });
    expect(profile).toMatchObject({
      valid: true,
      normalized: {
        agentId: 'custom-new-agent',
        createdByUser: true
      }
    });
    const customManifest = buildCustomAgentManifest(profile.normalized!);
    expect(customManifest).toMatchObject({
      agentId: 'custom-new-agent',
      displayName: 'New Agent',
      builtIn: false
    });
    expect(listAgentCatalog([profile.normalized!]).map((agent) => agent.agentId)).toEqual([...BUILT_IN_AGENT_IDS, 'custom-new-agent']);
    const targetProfile = validateCustomAgentProfile({
      ...profile.normalized!,
      profileId: 'custom-codex-profile',
      agentId: 'custom-codex-profile',
      targetAgentId: 'codex',
      displayName: 'Codex Extra Paths'
    });
    expect(targetProfile).toMatchObject({
      valid: true,
      normalized: {
        agentId: 'custom-codex-profile',
        targetAgentId: 'codex'
      }
    });
    expect(buildCustomAgentManifest(targetProfile.normalized!).macosPathProfile?.notes?.join('\n')).toContain('codex');
    expect(normalizeCustomAgentProfiles([profile.normalized!]).normalized).toHaveLength(1);
    expect(normalizeCustomAgentProfiles([
      profile.normalized!,
      { ...profile.normalized!, profileId: 'custom-new-agent-2' }
    ]).errors).toContain('agentProfiles[1].agentId custom-new-agent duplicates agentProfiles[0]');
    expect(normalizeCustomAgentProfiles([
      profile.normalized!,
      { ...profile.normalized!, agentId: 'custom-new-agent-2' }
    ]).errors).toContain('agentProfiles[1].profileId custom-new-agent duplicates agentProfiles[0]');
    expect(normalizeCustomAgentProfiles({}).errors).toContain('agentProfiles must be an array');
  });

  it('registers built-in dry-run adapters from the shared agent catalog', () => {
    const ids = createDryRunAdapters().map((adapter) => adapter.manifest.adapterId);
    expect(ids).toEqual(expect.arrayContaining(['custom-directory', ...BUILT_IN_AGENT_IDS]));
    expect(ids).not.toContain('claude');
  });
});

function customPathProfile(root: string) {
  return {
    platform: 'macos' as const,
    detectionRoots: [root],
    globalResourcePaths: [`${root}/settings.json`],
    projectResourcePaths: [],
    sourceLevel: 'USER_CONFIG_REQUIRED' as const,
    resourcePaths: {
      settings: [`${root}/settings.json`]
    }
  };
}
