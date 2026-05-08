import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSystemGuard } from '../src/main/executor/file-system-guard';
import { tempRoot } from './test-utils';

describe('FileSystemGuard', () => {
  it('allows declared temp roots and rejects traversal, roots, symlink escape, and unmanaged delete', async () => {
    const temp = await tempRoot();
    const outside = await tempRoot('eah-outside-');
    try {
      const guard = new FileSystemGuard();
      const managed = path.join(temp.root, 'managed');
      await mkdir(managed, { recursive: true });
      await expect(guard.assertSafePath(path.join(temp.root, 'managed', 'file.txt'), { roots: [temp.root] })).resolves.toContain(temp.root);
      await expect(guard.assertSafePath(path.join(temp.root, '..', path.basename(outside.root), 'escape.txt'), { roots: [temp.root] })).rejects.toMatchObject({ desktopError: { code: 'unsafe_path' } });
      await expect(guard.assertSafePath(path.parse(temp.root).root, { roots: [temp.root] })).rejects.toMatchObject({ desktopError: { code: 'unsafe_path' } });
      const link = path.join(temp.root, 'escape-link');
      await symlink(outside.root, link);
      await expect(guard.assertSafePath(link, { roots: [temp.root], allowMissing: false })).rejects.toMatchObject({ desktopError: { code: 'unsafe_path' } });
      await expect(guard.assertSafePath(path.join(link, 'child.txt'), { roots: [temp.root] })).rejects.toMatchObject({ desktopError: { code: 'unsafe_path' } });
      await expect(guard.assertSafePath(path.join(temp.root, 'unmanaged'), { roots: [temp.root], managedPaths: [managed], requireManaged: true })).rejects.toMatchObject({ desktopError: { code: 'unsafe_path' } });
    } finally {
      await temp.cleanup();
      await outside.cleanup();
    }
  });
});
