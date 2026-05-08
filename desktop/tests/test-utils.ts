import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function tempRoot(prefix = 'eah-desktop-'): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
