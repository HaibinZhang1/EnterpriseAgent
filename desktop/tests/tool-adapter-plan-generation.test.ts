import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MemorySecureStore } from '../src/main/security/secure-store';
import { validateAdapterManifest } from '../src/main/tool-adapters/manifest';
import { AdapterRegistry, AdapterScanner } from '../src/main/tool-adapters/registry';
import { DirectoryToolAdapter } from '../src/main/tool-adapters/builtin';
import { SkillService } from '../src/main/skill/skill-service';
import { McpService } from '../src/main/mcp/mcp-service';
import { PluginService } from '../src/main/plugin/plugin-service';
import { buildAppPaths } from '../src/main/config/app-paths';
import { tempRoot } from './test-utils';

describe('ToolAdapter and lifecycle plan generation', () => {
  it('validates manifests, matches capabilities, and scans configured roots only', async () => {
    const temp = await tempRoot();
    const adapter = new DirectoryToolAdapter();
    try {
      const scanRoot = path.join(temp.root, 'tools');
      const toolDir = path.join(scanRoot, 'codex');
      await mkdir(toolDir, { recursive: true });
      adapter.manifest.defaultScanPaths = [toolDir, path.join(temp.root, '..', 'escape')];
      expect(validateAdapterManifest(adapter.manifest).adapterId).toBe('custom-directory');
      const registry = new AdapterRegistry();
      registry.register(adapter);
      expect(registry.match({ extensionKind: 'skill', requiredCapabilities: ['copy'], platform: 'test' })).toHaveLength(1);
      expect(registry.explainNoMatch({ extensionKind: 'plugin', requiredCapabilities: ['connection-test'], platform: 'test' })).toContain('No adapter matched');
      await expect(new AdapterScanner([scanRoot]).scan(adapter)).resolves.toEqual([{ adapterId: 'custom-directory', path: toolDir, exists: true }]);
    } finally {
      await temp.cleanup();
    }
  });

  it('generates Skill, MCP, and Plugin safe plans without raw secrets or auto-install for manual download', async () => {
    const temp = await tempRoot();
    try {
      const paths = buildAppPaths(temp.root);
      const skillPlan = new SkillService(paths).createCopyFallbackPlan({ extensionId: 'skill-a', version: '1.0.0', targetPath: paths.tempDir });
      expect(skillPlan.steps.some((step) => step.action === 'copy-file')).toBe(true);
      const installPlan = new SkillService(paths).createInstallPlan({ extensionId: 'skill-a', version: '1.0.0', targetPath: paths.tempDir, packagePath: path.join(paths.tempDir, 'pkg') });
      expect(installPlan.steps.map((step) => step.action)).toEqual(['ensure-dir', 'copy-file', 'switch-pointer']);
      const disablePlan = new SkillService(paths).createDisablePlan({ extensionId: 'skill-a', version: '1.0.0', targetPath: paths.tempDir });
      expect(disablePlan.operation).toBe('SKILL_DISABLE');

      const mcp = await new McpService(new MemorySecureStore()).createConfigWritePlan({
        definition: { extensionId: 'mcp-a', version: '1.0.0', configTemplate: { command: 'remote' }, variablesSchema: [{ name: 'apiKey', sensitive: true }] },
        targetConfigPath: path.join(paths.tempDir, 'mcp.json'),
        variables: { apiKey: 'EAH_SENTINEL_SECRET_DO_NOT_PERSIST' }
      });
      expect(JSON.stringify(mcp.redactedPreview)).not.toContain('EAH_SENTINEL_SECRET_DO_NOT_PERSIST');
      expect(mcp.secretRefs.apiKey).toContain('mcp.variable.mcp-a.apiKey');
      const mcpUninstall = new McpService(new MemorySecureStore()).createUninstallPlan({
        definition: { extensionId: 'mcp-a', version: '1.0.0', configTemplate: {} },
        targetConfigPath: path.join(paths.tempDir, 'mcp.json')
      });
      expect(mcpUninstall.steps[0]).toMatchObject({ action: 'remove-managed', managed: true });
      expect(() => new McpService(new MemorySecureStore()).validateConnectionTest({ type: 'LOCAL_COMMAND', command: 'rm -rf /' })).toThrow(/Local MCP connection tests/);

      const pluginService = new PluginService();
      const managed = pluginService.createPlan({ extensionId: 'plugin-a', version: '1.0.0', installMode: 'MANAGED_PACKAGE', targetPath: paths.tempDir, packagePath: path.join(paths.tempDir, 'pkg') });
      expect(managed.steps[0].action).toBe('copy-file');
      expect(() => pluginService.createPlan({ extensionId: 'plugin-a', version: '1.0.0', installMode: 'MANAGED_PACKAGE', targetPath: paths.tempDir, manifest: { actions: [{ action: 'shell-command' }] } })).toThrow(/Unsupported/);
      const manual = pluginService.createPlan({ extensionId: 'plugin-b', version: '1.0.0', installMode: 'MANUAL_DOWNLOAD', targetPath: paths.tempDir });
      expect(manual.steps.map((step) => step.stepId)).toEqual(['open-manual-instructions', 'record-manual-download']);
      const manualInstalled = pluginService.createPlan({ extensionId: 'plugin-b', version: '1.0.0', installMode: 'MANUAL_DOWNLOAD', operation: 'mark-installed', targetPath: paths.tempDir });
      expect(manualInstalled.steps[1].content).toContain('"installed":true');
      const uninstall = pluginService.createPlan({ extensionId: 'plugin-a', version: '1.0.0', installMode: 'MANAGED_PACKAGE', operation: 'uninstall', targetPath: paths.tempDir });
      expect(uninstall.steps[0]).toMatchObject({ action: 'remove-managed', managed: true });
    } finally {
      await temp.cleanup();
    }
  });
});
