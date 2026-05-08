import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

export interface BackupRecord {
  id: string;
  originalPath: string;
  backupPath: string;
  existed: boolean;
  createdAt: string;
}

export class BackupStore {
  constructor(private readonly backupRoot: string) {}

  async backup(targetPath: string, exists: boolean): Promise<BackupRecord> {
    await mkdir(this.backupRoot, { recursive: true });
    const id = `backup_${randomUUID()}`;
    const backupPath = path.join(this.backupRoot, id);
    const record: BackupRecord = { id, originalPath: targetPath, backupPath, existed: exists, createdAt: new Date().toISOString() };
    if (exists) await cp(targetPath, backupPath, { recursive: true, force: true });
    await writeFile(path.join(this.backupRoot, `${id}.json`), `${JSON.stringify(record, null, 2)}
`, 'utf8');
    return record;
  }

  async restore(record: BackupRecord): Promise<void> {
    await rm(record.originalPath, { recursive: true, force: true });
    if (record.existed) await cp(record.backupPath, record.originalPath, { recursive: true, force: true });
  }
}
