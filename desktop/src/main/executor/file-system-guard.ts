import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

const DANGEROUS_POSIX = new Set(['/', '/bin', '/etc', '/usr', '/var', '/System', '/Library']);
const WINDOWS_ROOT = /^[A-Za-z]:\\?$/;

export interface PathGuardOptions {
  roots: string[];
  managedPaths?: string[];
  requireManaged?: boolean;
  allowMissing?: boolean;
}

export class FileSystemGuard {
  async assertSafePath(candidate: string, options: PathGuardOptions, requestID?: string): Promise<string> {
    const resolved = path.resolve(candidate);
    if (isDangerousRoot(resolved)) {
      throw new DesktopErrorException(makeDesktopError('unsafe_path', 'Dangerous root paths are not allowed', requestID, { candidate }));
    }
    const roots = options.roots.map((root) => path.resolve(root));
    if (!roots.some((root) => inside(root, resolved))) {
      throw new DesktopErrorException(makeDesktopError('unsafe_path', 'Path is outside declared target roots', requestID, { candidate }));
    }
    if (options.requireManaged) {
      const managed = (options.managedPaths ?? []).map((item) => path.resolve(item));
      if (!managed.some((item) => item === resolved || inside(item, resolved))) {
        throw new DesktopErrorException(makeDesktopError('unsafe_path', 'Only managed paths can be removed', requestID, { candidate }));
      }
    }
    await this.assertNoSymlinkEscape(resolved, roots, options.allowMissing ?? true, requestID);
    return resolved;
  }

  private async assertNoSymlinkEscape(resolved: string, roots: string[], allowMissing: boolean, requestID?: string): Promise<void> {
    const root = roots.find((candidate) => inside(candidate, resolved));
    if (root) {
      const relativeParts = path.relative(root, resolved).split(path.sep).filter(Boolean);
      let cursor = root;
      for (const part of relativeParts) {
        cursor = path.join(cursor, part);
        const done = cursor === resolved;
        try {
          const stat = await lstat(cursor);
          if (stat.isSymbolicLink()) {
            const target = await realpath(cursor);
            if (!inside(root, target)) {
              throw new DesktopErrorException(makeDesktopError('unsafe_path', 'Symlink target escapes declared roots', requestID, { path: cursor }));
            }
          }
        } catch (error) {
          if (isMissing(error) && (allowMissing || !done)) return;
          if (error instanceof DesktopErrorException) throw error;
          throw error;
        }
      }
      return;
    }
    try {
      const stat = await lstat(resolved);
      if (stat.isSymbolicLink()) {
        const target = await realpath(resolved);
        if (!roots.some((root) => inside(root, target))) {
          throw new DesktopErrorException(makeDesktopError('unsafe_path', 'Symlink target escapes declared roots', requestID, { path: resolved }));
        }
      }
    } catch (error) {
      if (allowMissing && isMissing(error)) return;
      if (error instanceof DesktopErrorException) throw error;
      throw error;
    }
  }
}

export function inside(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function isDangerousRoot(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  return DANGEROUS_POSIX.has(resolved) || WINDOWS_ROOT.test(resolved) || path.parse(resolved).root === resolved;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
