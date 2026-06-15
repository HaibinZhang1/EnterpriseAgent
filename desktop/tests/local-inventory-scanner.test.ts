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
      const summary = await new LocalInventoryScanner(paths, repository, { detectKnownTools: false }).scan();
      const snapshot = repository.list();
      const resources = repository.listResources();

      expect(summary.discovered).toMatchObject({ skills: 1, plugins: 1, mcpConfigs: 1, tools: 1, projects: 1, failures: 0, total: 5 });
      expect(snapshot.extensions.map((row) => row.extensionId)).toEqual(expect.arrayContaining(['skill.weather', 'plugin.ticket', 'mcp.crm']));
      expect(snapshot.targets.map((row) => row.target)).toEqual(expect.arrayContaining([
        path.join(paths.centralStoreSkillsDir, 'weather-skill'),
        path.join(paths.centralStorePluginsDir, 'ticket-plugin'),
        path.join(paths.mcpConfigsDir, 'crm.json')
      ]));
      expect(snapshot.tools).toMatchObject([{ extensionId: 'tool.git', toolName: 'git-search', status: 'scanned' }]);
      expect(snapshot.projects).toMatchObject([{ projectId: 'project.sales-agent', name: 'Sales Agent Project', status: 'scanned' }]);
      expect(resources.resources.map((row) => row.type)).toEqual(expect.arrayContaining(['SKILL', 'PLUGIN', 'MCP_SERVER', 'KIT', 'PROJECT']));
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
      const summary = await new LocalInventoryScanner(paths, repository, { homeDir: path.join(temp.root, 'home') }).scan();
      const snapshot = repository.list();
      const resources = repository.listResources();

      expect(summary.discovered.skills).toBe(1);
      expect(summary.discovered.tools).toBe(1);
      expect(snapshot.extensions).toMatchObject([{ extensionId: 'codex.skill.daily-helper', name: 'Daily Helper', status: 'scanned' }]);
      expect(snapshot.tools).toMatchObject([{ extensionId: 'tool.codex', toolName: 'Codex', status: 'scanned' }]);
      expect(resources.resources.map((row) => row.sourceType)).toEqual(expect.arrayContaining(['NATIVE_AGENT_DIRECTORY']));
      expect(resources.resources.map((row) => row.type)).toEqual(expect.arrayContaining(['SKILL', 'KIT']));
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
      const summary = await new LocalInventoryScanner(paths, repository, { detectKnownTools: false }).scan();
      const resources = repository.listResources();

      expect(summary.discovered.failures).toBe(1);
      expect(summary.failures[0]).toMatchObject({ code: 'manifest_parse_failed', resourceType: 'SKILL' });
      expect(resources.rows).toHaveLength(1);
      expect(resources.rows[0].status.label).toBe('操作失败');
      expect(resources.rows[0].binding?.detectionStatus).toBe('SCAN_FAILED');
      expect(resources.events).toMatchObject([{ eventType: 'CONFIG_SCAN_FAILED', status: 'failure', errorCode: 'manifest_parse_failed' }]);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
