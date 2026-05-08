import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackupStore } from '../src/main/executor/backup-store';
import { HashVerifier } from '../src/main/executor/hash-verifier';
import { RollbackManager } from '../src/main/executor/rollback-manager';
import { tempRoot } from './test-utils';

describe('BackupStore, RollbackManager, and HashVerifier', () => {
  it('backs up and restores content through rollback manager', async () => {
    const temp = await tempRoot();
    try {
      const target = path.join(temp.root, 'target.txt');
      await writeFile(target, 'before', 'utf8');
      const store = new BackupStore(path.join(temp.root, 'backups'));
      const record = await store.backup(target, true);
      await writeFile(target, 'after', 'utf8');

      await expect(new RollbackManager(store).rollback([record])).resolves.toEqual({ attempted: 1, failed: 0 });
      expect(await readFile(target, 'utf8')).toBe('before');
      expect(await readFile(path.join(temp.root, 'backups', `${record.id}.json`), 'utf8')).toContain('"existed": true');
    } finally {
      await temp.cleanup();
    }
  });

  it('verifies SHA-256 before executor copy steps can overwrite targets', async () => {
    const temp = await tempRoot();
    try {
      await mkdir(path.join(temp.root, 'source'), { recursive: true });
      const file = path.join(temp.root, 'source', 'package.bin');
      await writeFile(file, 'package', 'utf8');
      const expected = createHash('sha256').update('package').digest('hex');
      const verifier = new HashVerifier();

      await expect(verifier.verifyFile(file, expected)).resolves.toBeUndefined();
      await expect(verifier.verifyFile(file, 'bad-hash')).rejects.toMatchObject({ desktopError: { code: 'hash_mismatch' } });
      await expect(verifier.verifyFile(file, createHash('sha256').update('other').digest('hex'))).rejects.toMatchObject({ desktopError: { code: 'hash_mismatch' } });
    } finally {
      await temp.cleanup();
    }
  });
});
