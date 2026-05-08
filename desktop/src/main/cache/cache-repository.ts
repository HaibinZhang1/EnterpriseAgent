import { readFile, writeFile } from 'node:fs/promises';
import type { AppPaths } from '../config/app-paths';
import { resolveInsideRoot } from '../config/app-paths';
import { redactForLog } from '../../shared/redaction';

export class CacheRepository {
  constructor(private readonly paths: AppPaths) {}

  async writeCache(key: string, value: unknown): Promise<void> {
    const safeName = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const file = resolveInsideRoot(this.paths.cacheDir, `${safeName}.json`);
    await writeFile(file, `${JSON.stringify(redactForLog(value), null, 2)}\n`, 'utf8');
  }

  async readCache<T>(key: string): Promise<T | undefined> {
    const safeName = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const file = resolveInsideRoot(this.paths.cacheDir, `${safeName}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }
}
