import { randomUUID } from 'node:crypto';
import type { LocalDatabase } from '../db/local-database';
import { redactForLog } from '../../shared/redaction';
import { SyncStatuses, type LocalResourceType, type ServerAckStatus, type SyncStatus } from '../../shared/local-resources';

export type LocalEventStatus = 'pending' | 'retryable' | 'accepted' | 'rejected' | 'ignored' | 'failed';
export type LocalEventSyncResult = 'accepted' | 'rejected' | 'ignored';

export interface LocalEventInput {
  idempotencyKey?: string;
  deviceID: string;
  userID?: string;
  extensionID?: string;
  version?: string;
  eventType: string;
  operationID?: string;
  executionID?: string;
  resourceID?: string;
  bindingID?: string;
  resourceType?: LocalResourceType;
  agentID?: string;
  projectID?: string;
  kitID?: string;
  result?: string;
  errorCode?: string;
  failureReason?: string;
  suggestion?: string;
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
  operationID?: string;
  executionID?: string;
  resourceID?: string;
  bindingID?: string;
  resourceType?: LocalResourceType;
  agentID?: string;
  projectID?: string;
  kitID?: string;
  result?: string;
  errorCode?: string;
  failureReason?: string;
  suggestion?: string;
  offlineCreated: boolean;
  syncStatus: SyncStatus;
  serverAckStatus?: ServerAckStatus;
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
  operation_id?: string;
  execution_id?: string;
  resource_id?: string;
  binding_id?: string;
  resource_type?: LocalResourceType;
  agent_id?: string;
  project_id?: string;
  kit_id?: string;
  result?: string;
  error_code?: string;
  failure_reason?: string;
  suggestion?: string;
  offline_created?: number;
  sync_status?: SyncStatus;
  server_ack_status?: ServerAckStatus;
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
        operation_id, execution_id, resource_id, binding_id, resource_type, agent_id, project_id, kit_id,
        result, error_code, failure_reason, suggestion, offline_created, sync_status, payload_json,
        status, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', 0, ?, ?)`,
      [
        id,
        key,
        input.deviceID,
        input.userID ?? null,
        input.extensionID ?? null,
        input.version ?? null,
        input.eventType,
        input.operationID ?? null,
        input.executionID ?? null,
        input.resourceID ?? null,
        input.bindingID ?? null,
        input.resourceType ?? null,
        input.agentID ?? null,
        input.projectID ?? null,
        input.kitID ?? null,
        input.result ?? null,
        input.errorCode ?? null,
        input.failureReason ?? null,
        input.suggestion ?? null,
        SyncStatuses.PENDING_SYNC,
        payloadJson,
        now,
        now
      ]
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
      `UPDATE local_events SET status = ?, sync_status = ?, server_ack_status = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
      [result, result === 'rejected' ? SyncStatuses.SERVER_REJECTED : SyncStatuses.SYNCED, result, now, now, id]
    );
  }

  async markFailed(id: string, errorCode: string, retryable: boolean): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE local_events SET status = ?, sync_status = ?, error_code = ?, failure_reason = ?, attempt_count = attempt_count + 1, last_error = ?, updated_at = ? WHERE id = ?`,
      [retryable ? 'retryable' : 'failed', SyncStatuses.SYNC_FAILED, errorCode, errorCode, errorCode, now, id]
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
    operationID: row.operation_id ?? undefined,
    executionID: row.execution_id ?? undefined,
    resourceID: row.resource_id ?? undefined,
    bindingID: row.binding_id ?? undefined,
    resourceType: row.resource_type ?? undefined,
    agentID: row.agent_id ?? undefined,
    projectID: row.project_id ?? undefined,
    kitID: row.kit_id ?? undefined,
    result: row.result ?? undefined,
    errorCode: row.error_code ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    suggestion: row.suggestion ?? undefined,
    offlineCreated: row.offline_created !== 0,
    syncStatus: row.sync_status ?? SyncStatuses.PENDING_SYNC,
    serverAckStatus: row.server_ack_status ?? undefined,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at ?? undefined
  };
}
