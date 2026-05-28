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

      expect(summary.discovered).toMatchObject({ skills: 1, plugins: 1, mcpConfigs: 1, tools: 1, projects: 1, total: 5 });
      expect(snapshot.extensions.map((row) => row.extensionId)).toEqual(expect.arrayContaining(['skill.weather', 'plugin.ticket', 'mcp.crm']));
      expect(snapshot.targets.map((row) => row.target)).toEqual(expect.arrayContaining([
        path.join(paths.centralStoreSkillsDir, 'weather-skill'),
        path.join(paths.centralStorePluginsDir, 'ticket-plugin'),
        path.join(paths.mcpConfigsDir, 'crm.json')
      ]));
      expect(snapshot.tools).toMatchObject([{ extensionId: 'tool.git', toolName: 'git-search', status: 'scanned' }]);
      expect(snapshot.projects).toMatchObject([{ projectId: 'project.sales-agent', name: 'Sales Agent Project', status: 'scanned' }]);
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

      expect(summary.discovered.skills).toBe(1);
      expect(summary.discovered.tools).toBe(1);
      expect(snapshot.extensions).toMatchObject([{ extensionId: 'codex.skill.daily-helper', name: 'Daily Helper', status: 'scanned' }]);
      expect(snapshot.tools).toMatchObject([{ extensionId: 'tool.codex', toolName: 'Codex', status: 'scanned' }]);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
