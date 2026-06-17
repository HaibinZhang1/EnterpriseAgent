import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentInventoryScanner } from '../src/main/agents/agent-inventory-scanner';
import { buildAppPaths } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { AuditStatuses, LocalResourceTypes, PathStatuses } from '../src/shared/local-resources';
import { tempRoot } from './test-utils';

describe('phase 2 agent inventory scanner', () => {
  it('maps real local agent files into unified resources, bindings, files, and events', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      const project = path.join(temp.root, 'project');
      await mkdir(path.join(home, '.codex'), { recursive: true });
      await mkdir(path.join(home, '.enterprise-agent', 'local', 'codex', 'skills', 'weather'), { recursive: true });
      await mkdir(path.join(project, '.codex'), { recursive: true });
      await writeFile(path.join(home, '.codex', 'config.toml'), 'approval_policy = "never"\n', 'utf8');
      await writeFile(path.join(home, '.codex', 'AGENTS.md'), '# Global Codex Rules\n', 'utf8');
      await writeFile(path.join(home, '.enterprise-agent', 'local', 'codex', 'skills', 'weather', 'SKILL.md'), '# Weather Skill\n', 'utf8');
      await writeFile(path.join(project, 'AGENTS.md'), '# Project Agents\n', 'utf8');

      const repo = await createRepo(temp.root);
      const summary = await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: home,
        projectRoot: project,
        env: {},
        includeMissingPaths: false
      }).scan();
      const snapshot = repo.listResources();

      expect(summary.agents).toBe(10);
      expect(snapshot.bindings.map((binding) => binding.targetPath).filter(Boolean).join('\n')).not.toContain('<project>');
      expect(snapshot.resources.filter((resource) => resource.type === LocalResourceTypes.AGENT).map((resource) => resource.sourceId)).toEqual(expect.arrayContaining(['codex', 'claude-code', 'custom-directory']));
      expect(snapshot.resources.map((resource) => resource.type)).toEqual(expect.arrayContaining([LocalResourceTypes.AGENT_CONFIG, LocalResourceTypes.RULE, LocalResourceTypes.SKILL]));
      expect(snapshot.resources.find((resource) => resource.type === LocalResourceTypes.SKILL)?.name).toBe('weather');
      expect(snapshot.resources.some((resource) => resource.metadata?.kind === 'files')).toBe(false);
      expect(snapshot.bindings.some((binding) => binding.agentId === 'codex' && binding.pathStatus === 'OK')).toBe(true);
      expect(snapshot.files.some((file) => file.path.endsWith('config.toml') && file.previewAvailable)).toBe(true);
      expect(snapshot.events).toHaveLength(0);
    } finally {
      await temp.cleanup();
    }
  });

  it('binds project PathProfile resources to the supplied project and agent ids', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      const project = path.join(temp.root, 'project-alpha');
      await mkdir(path.join(home, '.codex'), { recursive: true });
      await mkdir(path.join(project, '.codex'), { recursive: true });
      await writeFile(path.join(home, '.codex', 'config.toml'), 'approval_policy = "never"\n', 'utf8');
      await writeFile(path.join(project, '.codex', 'config.toml'), 'model = "project-model"\n', 'utf8');
      await writeFile(path.join(project, 'AGENTS.md'), '# Project Agents\n', 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: home,
        projectRoot: project,
        projectId: 'project.alpha',
        env: {},
        includeMissingPaths: false
      }).scan();

      const snapshot = repo.listResources();
      const projectBindings = snapshot.bindings.filter((binding) => binding.projectId === 'project.alpha');
      expect(projectBindings.map((binding) => binding.agentId)).toEqual(expect.arrayContaining(['codex']));
      expect(projectBindings.every((binding) => binding.scopeType === 'AGENT_PROJECT')).toBe(true);
      expect(projectBindings.map((binding) => binding.targetPath)).toEqual(expect.arrayContaining([
        path.join(project, '.codex', 'config.toml'),
        path.join(project, 'AGENTS.md')
      ]));
      expect(snapshot.events).toHaveLength(0);
    } finally {
      await temp.cleanup();
    }
  });

  it('recognizes project-level agent directories even when global roots are absent', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home-without-global-agent-roots');
      const project = path.join(temp.root, 'project-with-agents');
      await mkdir(path.join(project, '.claude'), { recursive: true });
      await mkdir(path.join(project, '.codex'), { recursive: true });
      await mkdir(path.join(project, '.gemini'), { recursive: true });
      await mkdir(path.join(project, '.cursor', 'rules'), { recursive: true });
      await mkdir(path.join(project, '.opencode'), { recursive: true });
      await writeFile(path.join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: ['read'] }), 'utf8');
      await writeFile(path.join(project, '.codex', 'config.toml'), 'model = "project-model"\n', 'utf8');
      await writeFile(path.join(project, '.gemini', 'settings.json'), JSON.stringify({ tools: [] }), 'utf8');
      await writeFile(path.join(project, '.cursor', 'rules', 'main.mdc'), '# Cursor Rule\n', 'utf8');
      await writeFile(path.join(project, 'opencode.json'), JSON.stringify({ model: 'local' }), 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: home,
        projectRoot: project,
        projectId: 'project.multi-agent',
        env: {},
        includeMissingPaths: false
      }).scan();

      const snapshot = repo.listResources();
      const projectBindings = snapshot.bindings.filter((binding) => binding.projectId === 'project.multi-agent');
      const expectedPaths = [
        path.join(project, '.claude', 'settings.json'),
        path.join(project, '.codex', 'config.toml'),
        path.join(project, '.gemini', 'settings.json'),
        path.join(project, '.cursor', 'rules', 'main.mdc'),
        path.join(project, 'opencode.json')
      ];
      expect(projectBindings.map((binding) => binding.agentId)).toEqual(expect.arrayContaining([
        'claude-code',
        'codex',
        'gemini-cli',
        'cursor',
        'opencode'
      ]));
      expect(projectBindings.map((binding) => binding.targetPath)).toEqual(expect.arrayContaining(expectedPaths));
      for (const expectedPath of expectedPaths) {
        expect(projectBindings.find((binding) => binding.targetPath === expectedPath)).toMatchObject({
          pathStatus: PathStatuses.OK
        });
      }
      expect(snapshot.events).toHaveLength(0);
    } finally {
      await temp.cleanup();
    }
  });

  it('accepts Windows-style project paths with backslashes and spaces without scan failures', async () => {
    const temp = await tempRoot();
    try {
      const repo = await createRepo(temp.root);
      const summary = await new AgentInventoryScanner(repo, {
        platform: 'windows',
        homeDir: 'C:\\Users\\Alice Smith',
        userProfileDir: 'C:\\Users\\Alice Smith',
        projectRoot: 'D:\\Work Projects\\Repo App',
        projectId: 'project.windows',
        env: {},
        includeMissingPaths: false
      }).scan();

      expect(summary.failures).toBe(0);
      const snapshot = repo.listResources();
      expect(snapshot.bindings.some((binding) => binding.targetPath?.includes('Alice Smith'))).toBe(true);
      expect(JSON.stringify(snapshot.resources)).not.toContain('<project>');
    } finally {
      await temp.cleanup();
    }
  });

  it('surfaces parse failures through resource state without local-only events', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      await mkdir(path.join(home, '.gemini'), { recursive: true });
      await writeFile(path.join(home, '.gemini', 'settings.json'), '{ invalid json', 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false }).scan();
      const snapshot = repo.listResources();
      expect(snapshot.events).toHaveLength(0);
      expect(snapshot.rows.some((row) => row.status.label === '扫描失败')).toBe(true);
    } finally {
      await temp.cleanup();
    }
  });

  it('detects external file drift from existing file-backed hashes', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      await mkdir(path.join(home, '.codex'), { recursive: true });
      const configPath = path.join(home, '.codex', 'config.toml');
      await writeFile(configPath, 'model = "a"\n', 'utf8');
      const repo = await createRepo(temp.root);
      const scanner = new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false });
      await scanner.scan();
      await writeFile(configPath, 'model = "b"\n', 'utf8');
      await scanner.scan();
      const snapshot = repo.listResources();
      const driftedFile = snapshot.files.find((file) => file.path === configPath);
      expect(driftedFile).toMatchObject({ drifted: true, externalModified: true });
      expect(snapshot.bindings.find((binding) => binding.targetPath === configPath)).toMatchObject({ drifted: true, driftStatus: 'HASH_CHANGED' });
    } finally {
      await temp.cleanup();
    }
  });

  it('marks previously scanned resources as missing when the backing file is deleted', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      await mkdir(path.join(home, '.codex'), { recursive: true });
      const configPath = path.join(home, '.codex', 'config.toml');
      await writeFile(configPath, 'model = "a"\n', 'utf8');
      const repo = await createRepo(temp.root);
      const scanner = new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false });
      await scanner.scan();

      await rm(configPath);
      await scanner.scan();

      const snapshot = repo.listResources();
      expect(snapshot.bindings.find((binding) => binding.targetPath === configPath)).toMatchObject({
        pathStatus: PathStatuses.MISSING
      });
      expect(snapshot.events).toHaveLength(0);
    } finally {
      await temp.cleanup();
    }
  });

  it('parses Hook declarations without treating command docs as CLI binaries', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      await mkdir(path.join(home, '.claude', 'commands'), { recursive: true });
      const settingsPath = path.join(home, '.claude', 'settings.json');
      await writeFile(settingsPath, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash -lc "echo never-run"' }] }] } }), 'utf8');
      await writeFile(path.join(home, '.claude', 'commands', 'deploy.md'), 'command = "bash deploy.sh"\n', 'utf8');
      const repo = await createRepo(temp.root);
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.CLI_COMMAND,
        sourceId: 'claude-code:cli:legacy-config-file',
        name: 'Legacy Fake CLI',
        agentId: 'claude-code',
        targetPath: settingsPath,
        status: 'scanned',
        metadata: { kind: 'cli' }
      });
      await repo.recordAgentResource({
        resourceType: LocalResourceTypes.HOOK,
        sourceId: 'claude-code:hooks:legacy-config-file',
        name: 'Legacy Fake Hook',
        agentId: 'claude-code',
        targetPath: settingsPath,
        status: 'scanned',
        metadata: { kind: 'hooks' }
      });

      await new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false }).scan();
      const snapshot = repo.listResources();
      const hook = snapshot.resources.find((resource) => resource.type === LocalResourceTypes.HOOK);
      const cli = snapshot.resources.find((resource) => resource.type === LocalResourceTypes.CLI_COMMAND);
      expect(hook?.metadata).toMatchObject({
        hookEvent: 'PreToolUse',
        hookMatcher: 'Bash',
        command: 'bash -lc "echo never-run"',
        sourceConfigPath: settingsPath
      });
      expect(hook?.auditSummary.status).not.toBe(AuditStatuses.NOT_AUDITED);
      expect(snapshot.findings.some((finding) => finding.resourceType === LocalResourceTypes.HOOK)).toBe(true);
      expect(cli).toBeUndefined();
      expect(snapshot.findings.some((finding) => finding.resourceType === LocalResourceTypes.CLI_COMMAND)).toBe(false);
      expect(snapshot.events).toHaveLength(0);
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps Codex hooks.json as settings while deriving Hook resources only from entries', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      const project = path.join(temp.root, 'project');
      await mkdir(path.join(home, '.codex'), { recursive: true });
      await mkdir(path.join(project, '.codex'), { recursive: true });
      const globalHooksPath = path.join(home, '.codex', 'hooks.json');
      const projectHooksPath = path.join(project, '.codex', 'hooks.json');
      await writeFile(path.join(home, '.codex', 'config.toml'), 'model = "gpt"\n', 'utf8');
      await writeFile(globalHooksPath, JSON.stringify({ hooks: { PostToolUse: [{ command: 'echo global-hook' }] } }), 'utf8');
      await writeFile(projectHooksPath, JSON.stringify({ hooks: { PreToolUse: [{ command: 'echo project-hook' }] } }), 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: home,
        projectRoot: project,
        projectId: 'project.codex',
        env: {},
        includeMissingPaths: false
      }).scan();
      const snapshot = repo.listResources();
      const settingsPaths = snapshot.rows
        .filter((row) => row.resource.type === LocalResourceTypes.AGENT_CONFIG && row.binding?.agentId === 'codex')
        .map((row) => row.binding?.targetPath);
      const hookCommands = snapshot.resources
        .filter((resource) => resource.type === LocalResourceTypes.HOOK && resource.metadata?.agentId === 'codex')
        .map((resource) => resource.metadata?.command);

      expect(settingsPaths).toEqual(expect.arrayContaining([path.join(home, '.codex', 'config.toml'), globalHooksPath]));
      expect(settingsPaths).not.toContain(projectHooksPath);
      expect(hookCommands).toEqual(expect.arrayContaining(['echo global-hook', 'echo project-hook']));
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps Copilot hook config files visible as settings while deriving Hook entries', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      const project = path.join(temp.root, 'project');
      const vscodeUser = path.join(home, 'Library', 'Application Support', 'Code', 'User');
      await mkdir(path.join(home, '.copilot', 'hooks'), { recursive: true });
      await mkdir(vscodeUser, { recursive: true });
      await mkdir(path.join(project, '.github', 'hooks'), { recursive: true });
      await mkdir(path.join(project, '.vscode'), { recursive: true });
      const globalHookPath = path.join(home, '.copilot', 'hooks', 'notify.json');
      const projectHookPath = path.join(project, '.github', 'hooks', 'review.json');
      await writeFile(path.join(home, '.copilot', 'config.json'), JSON.stringify({ enabled: true }), 'utf8');
      await writeFile(path.join(vscodeUser, 'mcp.json'), JSON.stringify({ servers: {} }), 'utf8');
      await writeFile(path.join(project, '.vscode', 'mcp.json'), JSON.stringify({ servers: {} }), 'utf8');
      await writeFile(globalHookPath, JSON.stringify({ hooks: { PostToolUse: [{ command: 'echo copilot-global' }] } }), 'utf8');
      await writeFile(projectHookPath, JSON.stringify({ hooks: { PreToolUse: [{ command: 'echo copilot-project' }] } }), 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: home,
        projectRoot: project,
        projectId: 'project.copilot',
        env: {},
        includeMissingPaths: false
      }).scan();
      const snapshot = repo.listResources();
      const settingsPaths = snapshot.rows
        .filter((row) => row.resource.type === LocalResourceTypes.AGENT_CONFIG && row.binding?.agentId === 'copilot')
        .map((row) => row.binding?.targetPath);
      const hookCommands = snapshot.resources
        .filter((resource) => resource.type === LocalResourceTypes.HOOK && resource.metadata?.agentId === 'copilot')
        .map((resource) => resource.metadata?.command);

      expect(settingsPaths).toEqual(expect.arrayContaining([
        path.join(home, '.copilot', 'config.json'),
        path.join(vscodeUser, 'mcp.json'),
        path.join(project, '.vscode', 'mcp.json'),
        globalHookPath,
        projectHookPath
      ]));
      expect(hookCommands).toEqual(expect.arrayContaining(['echo copilot-global', 'echo copilot-project']));
    } finally {
      await temp.cleanup();
    }
  });

  it('follows symlinked Codex skill directories like HarnessKit', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      const skillTarget = path.join(temp.root, 'central-store', 'derived', 'codex-review-helper', 'codex_skill');
      const skillLink = path.join(home, '.codex', 'skills', 'codex-review-helper');
      await mkdir(skillTarget, { recursive: true });
      await mkdir(path.dirname(skillLink), { recursive: true });
      await writeFile(path.join(skillTarget, 'SKILL.md'), [
        '---',
        'name: codex-review-helper',
        'description: Review helper',
        '---',
        '# Codex Review Helper'
      ].join('\n'), 'utf8');
      await symlink(skillTarget, skillLink, 'dir');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false }).scan();
      const skillRows = repo.listResources().rows
        .filter((row) => row.resource.type === LocalResourceTypes.SKILL && row.binding?.agentId === 'codex');

      expect(skillRows.map((row) => row.binding?.targetPath)).toContain(path.join(skillLink, 'SKILL.md'));
      expect(skillRows.map((row) => row.resource.name)).toContain('codex-review-helper');
    } finally {
      await temp.cleanup();
    }
  });

  it('parses Codex MCP servers from config.toml entries', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      await mkdir(path.join(home, '.codex'), { recursive: true });
      const configPath = path.join(home, '.codex', 'config.toml');
      await writeFile(configPath, [
        '[mcp_servers.node_repl]',
        'command = "/usr/bin/node"',
        'args = ["server.js"]',
        '',
        '[mcp_servers.omx_state]',
        'command = "/usr/local/bin/node"',
        'args = ["state.js"]',
        '',
        '[mcp_servers.omx_state.env]',
        'OMX_STATE = "enabled"'
      ].join('\n'), 'utf8');
      const repo = await createRepo(temp.root);

      const summary = await new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false }).scan();
      const mcpRows = repo.listResources().rows
        .filter((row) => row.resource.type === LocalResourceTypes.MCP_SERVER && row.binding?.agentId === 'codex');

      expect(summary.failures).toBe(0);
      expect(mcpRows).toHaveLength(2);
      expect(mcpRows.map((row) => row.resource.name)).toEqual(expect.arrayContaining(['node_repl', 'omx_state']));
      expect(mcpRows.every((row) => row.binding?.targetPath === configPath)).toBe(true);
      expect(mcpRows.find((row) => row.resource.name === 'omx_state')?.resource.metadata).toMatchObject({
        command: '/usr/local/bin/node',
        args: ['state.js'],
        env: { OMX_STATE: 'enabled' }
      });
    } finally {
      await temp.cleanup();
    }
  });

  it('discovers nested Codex plugin cache manifests', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      const manifestPath = path.join(home, '.codex', 'plugins', 'cache', 'openai-bundled', 'browser', '26.1.0', '.codex-plugin', 'plugin.json');
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify({ name: 'browser', version: '26.1.0' }), 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false }).scan();
      const pluginRows = repo.listResources().rows
        .filter((row) => row.resource.type === LocalResourceTypes.PLUGIN && row.binding?.agentId === 'codex');

      expect(pluginRows).toHaveLength(1);
      expect(pluginRows[0]?.binding?.targetPath).toBe(manifestPath);
    } finally {
      await temp.cleanup();
    }
  });

  it('counts one latest Codex plugin entry when cache exposes a version alias', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      const versionDir = path.join(home, '.codex', 'plugins', 'cache', 'openai-bundled', 'chrome', '26.611.61753');
      const manifestPath = path.join(versionDir, '.codex-plugin', 'plugin.json');
      const latestDir = path.join(home, '.codex', 'plugins', 'cache', 'openai-bundled', 'chrome', 'latest');
      const latestManifestPath = path.join(latestDir, '.codex-plugin', 'plugin.json');
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify({ name: 'chrome', version: '26.611.61753' }), 'utf8');
      await symlink(versionDir, latestDir, 'dir');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false }).scan();
      const pluginRows = repo.listResources().rows
        .filter((row) => row.resource.type === LocalResourceTypes.PLUGIN && row.binding?.agentId === 'codex');

      expect(pluginRows).toHaveLength(1);
      expect(pluginRows[0]?.binding?.targetPath).toBe(latestManifestPath);
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps YAML Hook parsing inside the hooks block', async () => {
    const temp = await tempRoot();
    try {
      const home = path.join(temp.root, 'home');
      await mkdir(path.join(home, '.hermes'), { recursive: true });
      const configPath = path.join(home, '.hermes', 'config.yaml');
      await writeFile(configPath, [
        'hooks:',
        '  PreToolUse:',
        '    - matcher: Bash',
        '      command: echo real-hook',
        'commands:',
        '  deploy:',
        '    command: echo not-a-hook'
      ].join('\n'), 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, { platform: 'macos', homeDir: home, env: {}, includeMissingPaths: false }).scan();
      const hookCommands = repo.listResources().resources
        .filter((resource) => resource.type === LocalResourceTypes.HOOK && resource.metadata?.agentId === 'hermes')
        .map((resource) => resource.metadata?.command);

      expect(hookCommands).toEqual(['echo real-hook']);
    } finally {
      await temp.cleanup();
    }
  });

  it('scans a validated custom Agent Profile with built-in parity', async () => {
    const temp = await tempRoot();
    try {
      const customRoot = path.join(temp.root, 'custom-agent');
      await mkdir(path.join(customRoot, 'rules'), { recursive: true });
      await mkdir(path.join(customRoot, 'memory'), { recursive: true });
      await mkdir(path.join(customRoot, 'agents'), { recursive: true });
      await writeFile(path.join(customRoot, 'settings.json'), JSON.stringify({ version: '2.1.0', permissions: ['read'] }), 'utf8');
      await writeFile(path.join(customRoot, 'rules', 'main.md'), '# Custom Rule\n', 'utf8');
      await writeFile(path.join(customRoot, 'memory', 'team.md'), '# Team Memory\n', 'utf8');
      await writeFile(path.join(customRoot, 'agents', 'reviewer.md'), '# Reviewer Subagent\n', 'utf8');
      await writeFile(path.join(customRoot, '.agentignore'), 'tmp/\n', 'utf8');
      const repo = await createRepo(temp.root);

      const summary = await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: path.join(temp.root, 'home'),
        env: {},
        includeMissingPaths: false,
        customProfiles: [{
          profileId: 'custom-agent',
          agentId: 'custom-agent',
          displayName: 'Custom Directory',
          supportedPlatforms: ['macos', 'windows'],
          rootPaths: [customRoot],
          createdByUser: true,
          capabilities: ['detect', 'global-scope', 'project-scope', 'settings-read', 'static-audit'],
          pathProfile: {
            platform: 'macos',
            detectionRoots: [customRoot],
            globalResourcePaths: [path.join(customRoot, 'settings.json')],
            projectResourcePaths: [],
            sourceLevel: 'USER_CONFIG_REQUIRED',
            resourcePaths: {
              settings: [path.join(customRoot, 'settings.json')],
              rules: [path.join(customRoot, 'rules', '*.md')],
              memory: [path.join(customRoot, 'memory', '*.md')],
              subagents: [path.join(customRoot, 'agents', '*.md')],
              'ignore-files': [path.join(customRoot, '.agentignore')]
            }
          }
        }]
      }).scan();
      const snapshot = repo.listResources();

      expect(summary.agents).toBe(10);
      expect(snapshot.rows.some((row) => row.binding?.agentId === 'custom-agent' && row.resource.type === LocalResourceTypes.AGENT_CONFIG)).toBe(true);
      expect(snapshot.rows.some((row) => row.binding?.agentId === 'custom-agent' && row.resource.type === LocalResourceTypes.RULE)).toBe(true);
      expect(snapshot.rows.some((row) => row.binding?.agentId === 'custom-agent' && row.resource.type === LocalResourceTypes.MEMORY)).toBe(true);
      expect(snapshot.rows.some((row) => row.binding?.agentId === 'custom-agent' && row.resource.type === LocalResourceTypes.SUBAGENT)).toBe(true);
      expect(snapshot.rows.some((row) => row.binding?.agentId === 'custom-agent' && row.resource.type === LocalResourceTypes.IGNORE_FILE)).toBe(true);
      expect(snapshot.resources.filter((resource) => resource.sourceId?.startsWith('custom-agent:')).map((resource) => resource.sourceType)).toEqual(expect.arrayContaining(['CUSTOM_DIRECTORY']));
      expect(snapshot.resources.find((resource) => resource.sourceId === 'custom-agent')?.metadata).toMatchObject({ customProfileConfigured: true });
    } finally {
      await temp.cleanup();
    }
  });

  it('carries targetAgentId metadata for custom paths attached to built-in agents', async () => {
    const temp = await tempRoot();
    try {
      const customRoot = path.join(temp.root, 'codex-extra');
      await mkdir(customRoot, { recursive: true });
      await writeFile(path.join(customRoot, 'config.toml'), 'model = "extra"\n', 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: path.join(temp.root, 'home'),
        env: {},
        includeMissingPaths: false,
        customProfiles: [{
          profileId: 'custom-codex-extra',
          agentId: 'custom-codex-extra',
          targetAgentId: 'codex',
          displayName: 'Codex Extra Paths',
          supportedPlatforms: ['macos'],
          rootPaths: [customRoot],
          createdByUser: true,
          capabilities: ['detect', 'settings-read', 'static-audit'],
          pathProfile: {
            platform: 'macos',
            detectionRoots: [customRoot],
            globalResourcePaths: [path.join(customRoot, 'config.toml')],
            projectResourcePaths: [],
            sourceLevel: 'USER_CONFIG_REQUIRED',
            resourcePaths: {
              settings: [path.join(customRoot, 'config.toml')]
            }
          }
        }]
      }).scan();
      const snapshot = repo.listResources();
      const attachedAgent = snapshot.resources.find((resource) => resource.sourceId === 'custom-codex-extra');
      const attachedConfig = snapshot.rows.find((row) => row.binding?.agentId === 'custom-codex-extra' && row.resource.type === LocalResourceTypes.AGENT_CONFIG);

      expect(attachedAgent?.metadata).toMatchObject({
        customProfileId: 'custom-codex-extra',
        targetAgentId: 'codex',
        attachedToBuiltInAgent: true
      });
      expect(attachedConfig?.resource.metadata).toMatchObject({
        customProfileId: 'custom-codex-extra',
        targetAgentId: 'codex',
        staticOnly: true
      });
      expect(snapshot.events).toHaveLength(0);
    } finally {
      await temp.cleanup();
    }
  });

  it('records path-state failures on resources and continues scanning without local-only events', async () => {
    const temp = await tempRoot();
    try {
      const root = path.join(temp.root, 'custom-agent');
      const blocker = path.join(root, 'not-a-directory');
      await mkdir(root, { recursive: true });
      await writeFile(blocker, 'file', 'utf8');
      const repo = await createRepo(temp.root);

      const summary = await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: path.join(temp.root, 'home'),
        env: {},
        includeMissingPaths: false,
        customProfiles: [{
          profileId: 'custom-agent',
          agentId: 'custom-agent',
          displayName: 'Custom Directory',
          supportedPlatforms: ['macos'],
          rootPaths: [root],
          createdByUser: true,
          capabilities: ['detect', 'settings-read', 'static-audit'],
          pathProfile: {
            platform: 'macos',
            detectionRoots: [root],
            globalResourcePaths: [path.join(blocker, 'settings.json')],
            projectResourcePaths: [],
            sourceLevel: 'USER_CONFIG_REQUIRED',
            resourcePaths: {
              settings: [path.join(blocker, 'settings.json')]
            }
          }
        }]
      }).scan();
      const snapshot = repo.listResources();

      expect(summary.failures).toBeGreaterThan(0);
      expect(snapshot.events).toHaveLength(0);
      expect(snapshot.rows.some((row) => row.binding?.agentId === 'custom-agent' && row.status.label === '扫描失败')).toBe(true);
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps custom directory source transparency for existing-file parse failures', async () => {
    const temp = await tempRoot();
    try {
      const customRoot = path.join(temp.root, 'custom-agent');
      await mkdir(customRoot, { recursive: true });
      await writeFile(path.join(customRoot, 'settings.json'), '{ broken json', 'utf8');
      const repo = await createRepo(temp.root);

      await new AgentInventoryScanner(repo, {
        platform: 'macos',
        homeDir: path.join(temp.root, 'home'),
        env: {},
        includeMissingPaths: false,
        customProfiles: [{
          profileId: 'custom-agent',
          agentId: 'custom-agent',
          displayName: 'Custom Directory',
          supportedPlatforms: ['macos'],
          rootPaths: [customRoot],
          createdByUser: true,
          capabilities: ['detect', 'settings-read', 'static-audit'],
          pathProfile: {
            platform: 'macos',
            detectionRoots: [customRoot],
            globalResourcePaths: [path.join(customRoot, 'settings.json')],
            projectResourcePaths: [],
            sourceLevel: 'USER_CONFIG_REQUIRED',
            resourcePaths: {
              settings: [path.join(customRoot, 'settings.json')]
            }
          }
        }]
      }).scan();
      const snapshot = repo.listResources();
      const failureResource = snapshot.resources.find((resource) => resource.sourceId?.includes('config_parse_failed'));

      expect(failureResource).toMatchObject({
        sourceType: 'CUSTOM_DIRECTORY',
        type: LocalResourceTypes.AGENT_CONFIG
      });
      expect(snapshot.events).toHaveLength(0);
    } finally {
      await temp.cleanup();
    }
  });
});

async function createRepo(root: string): Promise<LocalLifecycleRepository> {
  const db = new LocalDatabase(path.join(buildAppPaths(root).root, 'local.db'));
  await db.initialize();
  return new LocalLifecycleRepository(db);
}
