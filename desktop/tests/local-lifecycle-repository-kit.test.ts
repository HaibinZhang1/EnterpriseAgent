import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { createEmptyPermissionSummary, createNotAuditedSummary, LocalResourceTypes } from '../src/shared/local-resources';
import { tempRoot } from './test-utils';

describe('LocalLifecycleRepository Kit normalization', () => {
  it('keeps manifest-less local_tools out of LocalResource KIT rows', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      await mkdir(path.join(temp.root, 'tool-target'), { recursive: true });
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);

      await repository.recordScannedTool({
        extensionId: 'tool.codex',
        target: path.join(temp.root, 'tool-target'),
        toolName: 'Codex',
        status: 'scanned',
        metadata: { source: 'known_tool_scan' }
      });

      const snapshot = repository.list();
      const resources = repository.listResources();

      expect(snapshot.tools).toMatchObject([{ extensionId: 'tool.codex', toolName: 'Codex', status: 'scanned' }]);
      expect(resources.resources.some((resource) => resource.type === LocalResourceTypes.KIT)).toBe(false);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('records local_tools as KIT only when metadata carries a valid KitManifest', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const kitTarget = path.join(temp.root, 'kit-target');
      await mkdir(kitTarget, { recursive: true });
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const repository = new LocalLifecycleRepository(db);
      const kitManifest = {
        kitId: 'kit.phase3',
        name: 'Phase 3 Kit',
        version: '1.0.0',
        sourceType: 'local',
        createdAt: '2026-06-16T00:00:00.000Z',
        supportedAgents: ['codex'],
        supportedPlatforms: ['macos'],
        resources: [{
          refId: 'rule.default',
          resourceType: LocalResourceTypes.RULE,
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

      await repository.recordScannedTool({
        extensionId: 'tool.phase3-kit',
        target: kitTarget,
        toolName: 'Phase 3 Kit Tool Record',
        status: 'scanned',
        metadata: { source: 'local_inventory_scan', kitManifest }
      });

      const resources = repository.listResources();
      const kit = resources.resources.find((resource) => resource.type === LocalResourceTypes.KIT);

      expect(kit).toMatchObject({
        sourceId: 'kit.phase3',
        name: 'Phase 3 Kit',
        version: '1.0.0',
        sourceType: 'KIT'
      });
      expect(kit?.metadata).toMatchObject({ kitManifest: { kitId: 'kit.phase3' }, legacyToolNormalizedAsKit: true });
      expect(resources.bindings.find((binding) => binding.resourceId === kit?.id)?.targetPath).toBe(kitTarget);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
