import type { LocalEventQueue, LocalEventRecord, LocalEventSyncResult } from './local-event-queue';

export interface LocalEventSyncAck {
  idempotencyKey: string;
  result: LocalEventSyncResult;
  errorCode?: string;
}

export type ServerLocalEventStatus = 'ACCEPTED' | 'IGNORED' | 'REJECTED';

export interface ServerLocalEventSyncResponse {
  results: Array<{ idempotencyKey: string; status: ServerLocalEventStatus; errorCode?: string }>;
  serverStateHints?: ServerStateHint[];
}

export interface ServerStateHint {
  extensionId: string;
  state: string;
  message?: string;
}

export interface LocalEventSyncTransportResult {
  acknowledgements: LocalEventSyncAck[];
  serverStateHints?: ServerStateHint[];
}

export type LocalEventSyncTransport = (events: LocalEventRecord[]) => Promise<LocalEventSyncAck[] | LocalEventSyncTransportResult>;

export interface LocalEventSyncSummary {
  attempted: number;
  accepted: number;
  rejected: number;
  ignored: number;
  failed: number;
  serverStateHints: ServerStateHint[];
  hintsApplied: number;
  hintsIgnored: number;
  skipped?: boolean;
  skipReason?: string;
  nextRetryAtMs?: number;
}

export interface ServerStateHintApplySummary {
  applied: number;
  ignored: number;
}

export type ServerStateHintApplier = (hints: ServerStateHint[]) => Promise<ServerStateHintApplySummary>;

export interface LocalEventSyncServiceOptions {
  applyServerStateHints?: ServerStateHintApplier;
  now?: () => number;
  jitter?: () => number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface NetworkRecoverySyncInput {
  online: boolean;
  previousOnline: boolean;
  reason: 'startup' | 'online-transition' | 'manual';
}

export class LocalEventSyncService {
  private failureCount = 0;
  private nextRetryAtMs = 0;

  constructor(
    private readonly queue: LocalEventQueue,
    private readonly transport: LocalEventSyncTransport,
    private readonly options: LocalEventSyncServiceOptions = {}
  ) {}

  async syncPending(): Promise<LocalEventSyncSummary> {
    const pending = this.queue.listPending();
    const summary = emptySummary(pending.length);
    if (pending.length === 0) return summary;

    try {
      const transportResult = normalizeTransportResult(await this.transport(pending));
      const acknowledgements = transportResult.acknowledgements;
      summary.serverStateHints = transportResult.serverStateHints ?? [];
      const hintSummary = await this.applyStateHints(summary.serverStateHints);
      summary.hintsApplied = hintSummary.applied;
      summary.hintsIgnored = hintSummary.ignored;
      for (const acknowledgement of acknowledgements) {
        const event = this.queue.findByIdempotencyKey(acknowledgement.idempotencyKey);
        if (!event) continue;
        await this.queue.markSynced(event.id, acknowledgement.result);
        summary[acknowledgement.result] += 1;
      }
      const acknowledgedKeys = new Set(acknowledgements.map((ack) => ack.idempotencyKey));
      for (const event of pending) {
        if (!acknowledgedKeys.has(event.idempotencyKey)) {
          await this.queue.markFailed(event.id, 'sync_ack_missing', true);
          summary.failed += 1;
        }
      }
      this.updateBackoff(summary);
      return summary;
    } catch {
      for (const event of pending) await this.queue.markFailed(event.id, 'server_unavailable', true);
      const failed = { ...summary, failed: pending.length };
      this.updateBackoff(failed);
      return failed;
    }
  }

  async syncAfterNetworkRecovery(input: NetworkRecoverySyncInput): Promise<LocalEventSyncSummary> {
    const pending = this.queue.listPending();
    if (!input.online) {
      return { ...emptySummary(0), skipped: true, skipReason: 'offline', nextRetryAtMs: this.nextRetryAtMs };
    }
    if (pending.length === 0) {
      this.failureCount = 0;
      this.nextRetryAtMs = 0;
      return { ...emptySummary(0), skipped: true, skipReason: 'no_pending_events' };
    }
    const shouldSync = input.reason === 'manual' || input.reason === 'startup' || !input.previousOnline;
    if (!shouldSync) {
      return { ...emptySummary(0), skipped: true, skipReason: 'not_a_recovery_transition', nextRetryAtMs: this.nextRetryAtMs };
    }
    const now = this.options.now?.() ?? Date.now();
    if (this.nextRetryAtMs > now) {
      return { ...emptySummary(0), skipped: true, skipReason: 'backoff_active', nextRetryAtMs: this.nextRetryAtMs };
    }
    return this.syncPending();
  }

  private async applyStateHints(hints: ServerStateHint[]): Promise<ServerStateHintApplySummary> {
    if (hints.length === 0 || !this.options.applyServerStateHints) return { applied: 0, ignored: 0 };
    return this.options.applyServerStateHints(hints);
  }

  private updateBackoff(summary: LocalEventSyncSummary): void {
    if (summary.failed === 0) {
      this.failureCount = 0;
      this.nextRetryAtMs = 0;
      return;
    }
    this.failureCount += 1;
    const base = this.options.baseBackoffMs ?? 1_000;
    const max = this.options.maxBackoffMs ?? 60_000;
    const jitter = Math.max(0, this.options.jitter?.() ?? Math.floor(Math.random() * 250));
    this.nextRetryAtMs = (this.options.now?.() ?? Date.now()) + Math.min(max, base * 2 ** (this.failureCount - 1)) + jitter;
    summary.nextRetryAtMs = this.nextRetryAtMs;
  }
}

export function mapServerLocalEventStatus(status: string): LocalEventSyncResult {
  if (status === 'ACCEPTED') return 'accepted';
  if (status === 'IGNORED') return 'ignored';
  if (status === 'REJECTED') return 'rejected';
  throw new Error(`Unsupported local-event sync status ${status}`);
}

function normalizeTransportResult(result: LocalEventSyncAck[] | LocalEventSyncTransportResult): LocalEventSyncTransportResult {
  return Array.isArray(result) ? { acknowledgements: result, serverStateHints: [] } : result;
}

function emptySummary(attempted: number): LocalEventSyncSummary {
  return { attempted, accepted: 0, rejected: 0, ignored: 0, failed: 0, serverStateHints: [], hintsApplied: 0, hintsIgnored: 0 };
}
