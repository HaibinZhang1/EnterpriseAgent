import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalInventoryScanner } from '../src/main/lifecycle/local-inventory-scanner';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { tempRoot } from './test-utils';

describe('LocalInventoryScanner', () => {
  it('discovers managed local skills, MCP configs, plugins, tools, and projects without renderer filesystem access', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      await mkdir(path.join(paths.centralStoreSkillsDir, 'weather-skill'));
      await writeFile(
        path.join(paths.centralStoreSkillsDir, 'weather-skill', 'manifest.json'),
        JSON.stringify({ extensionId: 'skill.weather', name: 'Weather Skill', summary: 'Weather helper', version: '1.2.3' })
      );
      await mkdir(path.join(paths.centralStorePluginsDir, 'ticket-plugin'));
      await writeFile(
        path.join(paths.centralStorePluginsDir, 'ticket-plugin', 'plugin.json'),
        JSON.stringify({ extensionId: 'plugin.ticket', name: 'Ticket Plugin', adapterId: 'MANAGED_PACKAGE', version: '2.0.0' })
      );
      await writeFile(
        path.join(paths.mcpConfigsDir, 'crm.json'),
        JSON.stringify({ extensionId: 'mcp.crm', name: 'CRM MCP', version: '0.3.0', mcpServers: { crm: {} } })
      );
      await mkdir(path.join(paths.adaptersDir, 'git-tool'));
      await writeFile(
        path.join(paths.adaptersDir, 'git-tool', 'manifest.json'),
        JSON.stringify({ extensionId: 'tool.git', toolName: 'git-search', version: '1.0.0' })
      );
      await mkdir(path.join(paths.projectsDir, 'sales-agent'));
      await writeFile(
        path.join(paths.projectsDir, 'sales-agent', 'project.json'),
        JSON.stringify({ projectId: 'project.sales-agent', name: 'Sales Agent Project', extensionId: 'skill.weather' })
      );

      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      const summary = await new LocalInventoryScanner(paths, repository, { detectKnownTools: false, homeDir: path.join(temp.root, 'home'), env: {} }).scan();
      const snapshot = repository.list();
      const resources = repository.listResources();

      expect(summary.discovered).toMatchObject({ skills: 1, plugins: 1, mcpConfigs: 1, tools: 1, projects: 1, failures: 0 });
      expect(summary.discovered.total).toBeGreaterThan(5);
      expect(snapshot.extensions.map((row) => row.extensionId)).toEqual(expect.arrayContaining(['skill.weather', 'plugin.ticket', 'mcp.crm']));
      expect(snapshot.targets.map((row) => row.target)).toEqual(expect.arrayContaining([
        path.join(paths.centralStoreSkillsDir, 'weather-skill'),
        path.join(paths.centralStorePluginsDir, 'ticket-plugin'),
        path.join(paths.mcpConfigsDir, 'crm.json')
      ]));
      expect(snapshot.tools).toMatchObject([{ extensionId: 'tool.git', toolName: 'git-search', status: 'scanned' }]);
      expect(snapshot.projects).toMatchObject([{ projectId: 'project.sales-agent', name: 'Sales Agent Project', status: 'scanned' }]);
      expect(resources.resources.map((row) => row.type)).toEqual(expect.arrayContaining(['SKILL', 'PLUGIN', 'MCP_SERVER', 'PROJECT']));
      expect(resources.resources.some((row) => row.type === 'KIT')).toBe(false);
      expect(resources.bindings.map((row) => row.detectionStatus)).toEqual(expect.arrayContaining(['DETECTED']));
      expect(resources.rows.map((row) => row.status.label)).toEqual(expect.arrayContaining(['已记录']));
      expect(resources.files.map((row) => row.path)).toEqual(expect.arrayContaining([
        path.join(paths.centralStoreSkillsDir, 'weather-skill'),
        path.join(paths.centralStorePluginsDir, 'ticket-plugin'),
        path.join(paths.mcpConfigsDir, 'crm.json')
      ]));
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('detects Codex skills from known local tool paths without scanning the whole disk', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(path.join(temp.root, 'app-data'));
      const codexSkillDir = path.join(temp.root, 'home', '.codex', 'skills', 'daily-helper');
      await mkdir(codexSkillDir, { recursive: true });
      await writeFile(path.join(codexSkillDir, 'SKILL.md'), '# Daily Helper\n\nHelps with local tasks.\n');

      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      const summary = await new LocalInventoryScanner(paths, repository, { homeDir: path.join(temp.root, 'home'), env: {} }).scan();
      const snapshot = repository.list();
      const resources = repository.listResources();

      expect(summary.discovered.skills).toBe(1);
      expect(summary.discovered.tools).toBe(1);
      expect(summary.discovered.total).toBeGreaterThanOrEqual(summary.discovered.skills + summary.discovered.tools);
      expect(snapshot.extensions).toMatchObject([{ extensionId: 'codex.skill.daily-helper', name: 'Daily Helper', status: 'scanned' }]);
      expect(snapshot.tools).toMatchObject([{ extensionId: 'tool.codex', toolName: 'Codex', status: 'scanned' }]);
      expect(resources.resources.map((row) => row.sourceType)).toEqual(expect.arrayContaining(['NATIVE_AGENT_DIRECTORY']));
      expect(resources.resources.map((row) => row.type)).toEqual(expect.arrayContaining(['SKILL']));
      expect(resources.resources.some((row) => row.type === 'KIT')).toBe(false);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('records malformed local manifests as observable scan failures instead of empty success', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      await mkdir(path.join(paths.centralStoreSkillsDir, 'broken-skill'));
      await writeFile(path.join(paths.centralStoreSkillsDir, 'broken-skill', 'manifest.json'), '{ broken json');

      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      const summary = await new LocalInventoryScanner(paths, repository, { detectKnownTools: false, homeDir: path.join(temp.root, 'home'), env: {} }).scan();
      const resources = repository.listResources();

      expect(summary.discovered.failures).toBe(1);
      expect(summary.discovered.total).toBeGreaterThanOrEqual(10);
      expect(summary.failures[0]).toMatchObject({ code: 'manifest_parse_failed', resourceType: 'SKILL' });
      const failureRow = resources.rows.find((row) => row.resource.sourceId?.includes('manifest_parse_failed'));
      expect(failureRow?.status.label).toBe('操作失败');
      expect(failureRow?.binding?.detectionStatus).toBe('SCAN_FAILED');
      expect(resources.events).toContainEqual(expect.objectContaining({ eventType: 'CONFIG_SCAN_FAILED', status: 'failure', errorCode: 'manifest_parse_failed' }));
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('loads configured custom Agent Profiles from local settings into the agent scanner', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const customRoot = path.join(temp.root, 'custom-agent');
      await mkdir(customRoot, { recursive: true });
      await writeFile(path.join(customRoot, 'settings.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');
      await writeFile(paths.configFile, `${JSON.stringify({
        agentProfiles: [{
          profileId: 'custom-agent',
          agentId: 'custom-agent',
          displayName: 'Custom Directory',
          supportedPlatforms: ['macos', 'windows'],
          rootPaths: [customRoot],
          createdByUser: true,
          pathProfile: {
            platform: process.platform === 'win32' ? 'windows' : 'macos',
            detectionRoots: [customRoot],
            globalResourcePaths: [path.join(customRoot, 'settings.json')],
            projectResourcePaths: [],
            sourceLevel: 'USER_CONFIG_REQUIRED',
            resourcePaths: {
              settings: [path.join(customRoot, 'settings.json')]
            }
          }
        }]
      }, null, 2)}\n`);

      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      const summary = await new LocalInventoryScanner(paths, repository, { detectKnownTools: false, homeDir: path.join(temp.root, 'home'), env: {} }).scan();
      const resources = repository.listResources();

      expect(summary.discovered.failures).toBe(0);
      expect(resources.rows.some((row) => row.binding?.agentId === 'custom-agent' && row.resource.type === 'AGENT_CONFIG')).toBe(true);
      expect(resources.resources.find((resource) => resource.sourceId === 'custom-agent')?.metadata).toMatchObject({ customProfileConfigured: true });
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('scans recorded local_projects paths as project roots for agent Path Profiles', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const home = path.join(temp.root, 'home');
      const projectDir = path.join(temp.root, 'workspace-alpha');
      await mkdir(path.join(home, '.codex'), { recursive: true });
      await mkdir(path.join(projectDir, '.codex'), { recursive: true });
      await writeFile(path.join(home, '.codex', 'config.toml'), 'approval_policy = "never"\n', 'utf8');
      await writeFile(path.join(projectDir, 'AGENTS.md'), '# Workspace Alpha\n', 'utf8');
      await writeFile(path.join(projectDir, '.codex', 'config.toml'), 'model = "project"\n', 'utf8');

      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      await repository.recordScannedProject({
        projectId: 'project.alpha',
        name: 'Workspace Alpha',
        status: 'scanned',
        metadata: { target: projectDir }
      });

      const summary = await new LocalInventoryScanner(paths, repository, { detectKnownTools: false, homeDir: home, env: {} }).scan();
      const resources = repository.listResources();
      const projectRows = resources.rows.filter((row) => row.binding?.projectId === 'project.alpha' && row.binding?.agentId === 'codex');

      expect(summary.discovered.projects).toBe(1);
      expect(projectRows.map((row) => row.binding?.targetPath)).toEqual(expect.arrayContaining([
        path.join(projectDir, 'AGENTS.md'),
        path.join(projectDir, '.codex', 'config.toml')
      ]));
      expect(projectRows.every((row) => row.binding?.scopeType === 'AGENT_PROJECT')).toBe(true);
      expect(resources.events.some((event) => event.projectId === 'project.alpha' && event.agentId === 'codex')).toBe(true);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps multiple configured custom Agent Profiles as separate scanner identities', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const firstRoot = path.join(temp.root, 'custom-one');
      const secondRoot = path.join(temp.root, 'custom-two');
      await mkdir(firstRoot, { recursive: true });
      await mkdir(secondRoot, { recursive: true });
      await writeFile(path.join(firstRoot, 'settings.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');
      await writeFile(path.join(secondRoot, 'settings.json'), JSON.stringify({ version: '2.0.0' }), 'utf8');
      await writeFile(paths.configFile, `${JSON.stringify({
        agentProfiles: [
          customProfile('custom-one', 'Custom One', firstRoot),
          customProfile('custom-two', 'Custom Two', secondRoot)
        ]
      }, null, 2)}\n`);

      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      await new LocalInventoryScanner(paths, repository, { detectKnownTools: false, homeDir: path.join(temp.root, 'home'), env: {} }).scan();
      const resources = repository.listResources();

      expect(resources.resources.filter((resource) => resource.type === 'AGENT').map((resource) => resource.sourceId)).toEqual(expect.arrayContaining(['custom-one', 'custom-two']));
      expect(resources.rows.some((row) => row.binding?.agentId === 'custom-one' && row.resource.type === 'AGENT_CONFIG')).toBe(true);
      expect(resources.rows.some((row) => row.binding?.agentId === 'custom-two' && row.resource.type === 'AGENT_CONFIG')).toBe(true);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('records invalid custom Agent Profile settings with custom-directory source transparency', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const customRoot = path.join(temp.root, 'custom-agent');
      await writeFile(paths.configFile, `${JSON.stringify({
        agentProfiles: [{
          profileId: 'custom-directory',
          agentId: 'custom-directory',
          displayName: 'Reserved Custom Directory',
          supportedPlatforms: ['macos'],
          rootPaths: [customRoot],
          createdByUser: true,
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
      }, null, 2)}\n`);

      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      const summary = await new LocalInventoryScanner(paths, repository, { detectKnownTools: false, homeDir: path.join(temp.root, 'home'), env: {} }).scan();
      const resources = repository.listResources();
      const failure = resources.resources.find((resource) => resource.sourceId?.includes('agent_profiles_invalid'));

      expect(summary.discovered.failures).toBeGreaterThan(0);
      expect(failure).toMatchObject({
        sourceType: 'CUSTOM_DIRECTORY',
        type: 'AGENT_CONFIG'
      });
      expect(resources.events).toContainEqual(expect.objectContaining({
        eventType: 'CONFIG_SCAN_FAILED',
        errorCode: 'agent_profiles_invalid',
        status: 'failure',
        failureReason: expect.stringContaining('reserved')
      }));
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});

function customProfile(agentId: string, displayName: string, root: string) {
  return {
    profileId: agentId,
    agentId,
    displayName,
    supportedPlatforms: ['macos', 'windows'],
    rootPaths: [root],
    createdByUser: true,
    pathProfile: {
      platform: process.platform === 'win32' ? 'windows' : 'macos',
      detectionRoots: [root],
      globalResourcePaths: [path.join(root, 'settings.json')],
      projectResourcePaths: [],
      sourceLevel: 'USER_CONFIG_REQUIRED',
      resourcePaths: {
        settings: [path.join(root, 'settings.json')]
      }
    }
  };
}
