import { BackupStore, type BackupRecord } from './backup-store';

export interface RollbackSummary {
  attempted: number;
  failed: number;
}

export class RollbackManager {
  constructor(private readonly backupStore: BackupStore) {}

  async rollback(records: BackupRecord[]): Promise<RollbackSummary> {
    let failed = 0;
    for (const record of [...records].reverse()) {
      try {
        await this.backupStore.restore(record);
      } catch {
        failed += 1;
      }
    }
    return { attempted: records.length, failed };
  }
}
