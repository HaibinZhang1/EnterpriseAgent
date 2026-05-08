import { randomUUID } from 'node:crypto';
import type { LocalDatabase } from '../db/local-database';
import { redactForLog } from '../../shared/redaction';

export type LocalEventStatus = 'pending' | 'retryable' | 'accepted' | 'rejected' | 'ignored' | 'failed';
export type LocalEventSyncResult = 'accepted' | 'rejected' | 'ignored';

export interface LocalEventInput {
  idempotencyKey?: string;
  deviceID: string;
  userID?: string;
  extensionID?: string;
  version?: string;
  eventType: string;
  result?: string;
  errorCode?: string;
  payload?: Record<string, unknown>;
}

export interface LocalEventRecord {
  id: string;
  idempotencyKey: string;
  deviceID: string;
  userID?: string;
  extensionID?: string;
  version?: string;
  eventType: string;
  result?: string;
  errorCode?: string;
  payload: Record<string, unknown>;
  status: LocalEventStatus;
  attemptCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
}

interface LocalEventRow {
  id: string;
  idempotency_key: string;
  device_id: string;
  user_id?: string;
  extension_id?: string;
  version?: string;
  event_type: string;
  result?: string;
  error_code?: string;
  payload_json: string;
  status: LocalEventStatus;
  attempt_count: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
  synced_at?: string;
}

export class LocalEventQueue {
  constructor(private readonly db: LocalDatabase) {}

  async enqueue(input: LocalEventInput): Promise<LocalEventRecord> {
    const key = input.idempotencyKey ?? `event_${randomUUID()}`;
    const existing = this.findByIdempotencyKey(key);
    if (existing) return existing;

    const now = new Date().toISOString();
    const id = `local_event_${randomUUID()}`;
    const payloadJson = JSON.stringify(redactForLog(input.payload ?? {}));
    await this.db.run(
      `INSERT INTO local_events(
        id, idempotency_key, device_id, user_id, extension_id, version, event_type,
        result, error_code, payload_json, status, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [id, key, input.deviceID, input.userID ?? null, input.extensionID ?? null, input.version ?? null, input.eventType, input.result ?? null, input.errorCode ?? null, payloadJson, now, now]
    );
    return this.findByIdempotencyKey(key) as LocalEventRecord;
  }

  listPending(): LocalEventRecord[] {
    return this.db.query<LocalEventRow>(
      `SELECT * FROM local_events WHERE status IN ('pending', 'retryable') ORDER BY created_at ASC`
    ).map(mapRow);
  }

  async markSynced(id: string, result: LocalEventSyncResult): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE local_events SET status = ?, result = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
      [result, result, now, now, id]
    );
  }

  async markFailed(id: string, errorCode: string, retryable: boolean): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE local_events SET status = ?, error_code = ?, attempt_count = attempt_count + 1, last_error = ?, updated_at = ? WHERE id = ?`,
      [retryable ? 'retryable' : 'failed', errorCode, errorCode, now, id]
    );
  }

  findByIdempotencyKey(idempotencyKey: string): LocalEventRecord | undefined {
    return this.db.query<LocalEventRow>(`SELECT * FROM local_events WHERE idempotency_key = ?`, [idempotencyKey]).map(mapRow)[0];
  }
}

function mapRow(row: LocalEventRow): LocalEventRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    deviceID: row.device_id,
    userID: row.user_id ?? undefined,
    extensionID: row.extension_id ?? undefined,
    version: row.version ?? undefined,
    eventType: row.event_type,
    result: row.result ?? undefined,
    errorCode: row.error_code ?? undefined,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at ?? undefined
  };
}
