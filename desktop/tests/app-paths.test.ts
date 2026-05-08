import { stat, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildAppPaths, initializeAppDataLayout, resolveInsideRoot } from '../src/main/config/app-paths';
import { DeviceIdStore } from '../src/main/config/device-id-store';
import { LocalDatabase } from '../src/main/db/local-database';
import { tempRoot } from './test-utils';

async function expectPathExists(file: string) {
  await expect(stat(file)).resolves.toBeTruthy();
}

describe('AppPaths and DeviceIdStore', () => {
  it('initializes the reconciled M6 layout under an injected root', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const device = await new DeviceIdStore(paths).getOrCreate();
      await new LocalDatabase(paths.localDbFile).initialize();

      await expectPathExists(paths.configFile);
      await expectPathExists(paths.deviceFile);
      await expectPathExists(paths.localDbFile);
      await expectPathExists(paths.centralStoreSkillsDir);
      await expectPathExists(paths.centralStorePluginsDir);
      await expectPathExists(paths.mcpConfigsDir);
      await expectPathExists(paths.mcpVariablesDir);
      await expectPathExists(paths.adaptersDir);
      await expectPathExists(paths.tempDir);
      await expectPathExists(paths.backupsDir);
      await expectPathExists(paths.eventsDir);
      await expectPathExists(paths.cacheDir);
      await expectPathExists(paths.logsDir);
      expect(device.deviceID).toMatch(/^device_/);
      expect(JSON.stringify(JSON.parse(await readFile(paths.deviceFile, 'utf8')))).not.toMatch(/token|secret|password/i);
    } finally {
      await temp.cleanup();
    }
  });

  it('keeps deviceID stable and rejects path traversal outside root', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const store = new DeviceIdStore(paths);
      const first = await store.getOrCreate();
      const second = await new DeviceIdStore(buildAppPaths(temp.root)).getOrCreate();
      expect(second.deviceID).toBe(first.deviceID);
      expect(resolveInsideRoot(paths.root, 'cache/result.json')).toContain(paths.root);
      expect(() => resolveInsideRoot(paths.root, '../outside')).toThrow(/escapes/);
    } finally {
      await temp.cleanup();
    }
  });
});
