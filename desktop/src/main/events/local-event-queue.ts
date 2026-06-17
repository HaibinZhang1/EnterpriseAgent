import { randomUUID } from 'node:crypto';
import type { LocalDatabase } from '../db/local-database';
import { redactForLog } from '../../shared/redaction';
import { SyncStatuses, type LocalResourceType, type ServerAckStatus, type SyncStatus } from '../../shared/local-resources';

export type LocalEventStatus = 'pending' | 'retryable' | 'accepted' | 'rejected' | 'ignored' | 'failed';
export type LocalEventSyncResult = 'accepted' | 'rejected' | 'ignored';

const FORBIDDEN_RUNTIME_EVENT_TYPES = new Set([
  'CLI_COMMAND_EXECUTED',
  'CLI_EXECUTED',
  'HOOK_TRIGGERED',
  'HOOK_RUNTIME_STARTED',
  'HOOK_RUNTIME_FINISHED',
  'AGENT_TOOL_CALLED',
  'trigger-hook',
  'execute-cli'
]);

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
  offlineCreated?: boolean;
  syncStatus?: SyncStatus;
  status?: LocalEventStatus;
  serverAckStatus?: ServerAckStatus;
  createdAt?: string;
  updatedAt?: string;
  payload?: Record<string, unknown>;
}

export interface LocalEventFilters {
  resourceType?: LocalResourceType;
  resourceID?: string;
  bindingID?: string;
  agentID?: string;
  projectID?: string;
  kitID?: string;
  eventType?: string;
  result?: string;
  status?: LocalEventStatus;
  syncStatus?: SyncStatus;
  offlineCreated?: boolean;
  since?: string;
  until?: string;
  limit?: number;
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
    rejectForbiddenRuntimeEvent(input.eventType);
    const key = input.idempotencyKey ?? `event_${randomUUID()}`;
    const existing = this.findByIdempotencyKey(key);
    if (existing) return existing;

    const now = input.createdAt ?? new Date().toISOString();
    const updatedAt = input.updatedAt ?? now;
    const id = `local_event_${randomUUID()}`;
    const offlineCreated = input.offlineCreated ?? false;
    const syncStatus = input.syncStatus ?? SyncStatuses.PENDING_SYNC;
    const queueStatus = input.status ?? (syncStatus === SyncStatuses.LOCAL_ONLY ? 'accepted' : 'pending');
    const payloadJson = JSON.stringify(redactForLog(input.payload ?? {}));
    await this.db.run(
      `INSERT INTO local_events(
        id, idempotency_key, device_id, user_id, extension_id, version, event_type,
        operation_id, execution_id, resource_id, binding_id, resource_type, agent_id, project_id, kit_id,
        result, error_code, failure_reason, suggestion, offline_created, sync_status, payload_json,
        status, server_ack_status, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
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
        offlineCreated ? 1 : 0,
        syncStatus,
        payloadJson,
        queueStatus,
        input.serverAckStatus ?? (queueStatus === 'accepted' && syncStatus === SyncStatuses.LOCAL_ONLY ? 'accepted' : null),
        now,
        updatedAt
      ]
    );
    return this.findByIdempotencyKey(key) as LocalEventRecord;
  }

  list(filters: LocalEventFilters = {}): LocalEventRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    addFilter(clauses, params, 'resource_type', filters.resourceType);
    addFilter(clauses, params, 'resource_id', filters.resourceID);
    addFilter(clauses, params, 'binding_id', filters.bindingID);
    addFilter(clauses, params, 'agent_id', filters.agentID);
    addFilter(clauses, params, 'project_id', filters.projectID);
    addFilter(clauses, params, 'kit_id', filters.kitID);
    addFilter(clauses, params, 'event_type', filters.eventType);
    addFilter(clauses, params, 'result', filters.result);
    addFilter(clauses, params, 'status', filters.status);
    addFilter(clauses, params, 'sync_status', filters.syncStatus);
    if (filters.offlineCreated !== undefined) {
      clauses.push('offline_created = ?');
      params.push(filters.offlineCreated ? 1 : 0);
    }
    if (filters.since) {
      clauses.push('created_at >= ?');
      params.push(filters.since);
    }
    if (filters.until) {
      clauses.push('created_at <= ?');
      params.push(filters.until);
    }
    const limit = Math.max(1, Math.min(filters.limit ?? 500, 2000));
    params.push(limit);
    return this.db.query<LocalEventRow>(
      `SELECT * FROM local_events
       ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT ?`,
      params
    ).map(mapRow);
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

function rejectForbiddenRuntimeEvent(eventType: string): void {
  if (!FORBIDDEN_RUNTIME_EVENT_TYPES.has(eventType)) return;
  throw new Error(`Runtime event type is not allowed in LocalEventQueue: ${eventType}`);
}

function addFilter(clauses: string[], params: Array<string | number>, column: string, value: string | undefined): void {
  if (!value) return;
  clauses.push(`${column} = ?`);
  params.push(value);
}

function mapRow(row: LocalEventRow): LocalEventRecord {
  const payload = safeParseObject(row.payload_json);
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
    payload,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at ?? undefined
  };
}

function safeParseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
