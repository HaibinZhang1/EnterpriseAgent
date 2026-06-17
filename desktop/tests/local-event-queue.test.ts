import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalEventQueue } from '../src/main/events/local-event-queue';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { LocalEventTypes, LocalResourceTypes, SyncStatuses } from '../src/shared/local-resources';
import { tempRoot } from './test-utils';

describe('LocalEventQueue', () => {
  it('persists pending events, returns existing rows for duplicate idempotency keys, redacts payloads, and drops acked rows', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      const first = await queue.enqueue({
        idempotencyKey: 'dup-key',
        deviceID: 'device_1',
        userID: 'user_1',
        extensionID: 'ext_1',
        version: '1.0.0',
        eventType: 'extension.cached',
        payload: { token: 'secret-token', nested: { downloadTicket: 'ticket-123' } }
      });
      const duplicate = await queue.enqueue({ idempotencyKey: 'dup-key', deviceID: 'device_1', eventType: 'extension.cached' });
      expect(duplicate.id).toBe(first.id);
      expect(queue.listPending()).toHaveLength(1);
      expect(JSON.stringify(first.payload)).not.toContain('secret-token');
      expect(JSON.stringify(first.payload)).not.toContain('ticket-123');

      await queue.markFailed(first.id, 'server_unavailable', true);
      expect(queue.listPending()[0].attemptCount).toBe(1);
      await queue.markSynced(first.id, 'accepted');
      expect(queue.listPending()).toHaveLength(0);
      expect(queue.findByIdempotencyKey('dup-key')?.result).toBeUndefined();
      await db.close();

      const reopened = new LocalDatabase(paths.localDbFile);
      await reopened.initialize();
      const reopenedQueue = new LocalEventQueue(reopened);
      expect(reopenedQueue.findByIdempotencyKey('dup-key')).toBeUndefined();
      await reopened.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('removes events once sync is accepted rejected or ignored', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      const accepted = await queue.enqueue({
        idempotencyKey: 'accepted-failure',
        deviceID: 'device_1',
        eventType: 'verify.failed',
        result: 'FAILURE',
        errorCode: 'hash_mismatch'
      });
      const rejected = await queue.enqueue({
        idempotencyKey: 'rejected-failure',
        deviceID: 'device_1',
        eventType: 'verify.failed',
        result: 'FAILURE'
      });
      const ignored = await queue.enqueue({
        idempotencyKey: 'ignored-cancelled',
        deviceID: 'device_1',
        eventType: 'user.cancelled',
        result: 'CANCELLED'
      });

      await queue.markSynced(accepted.id, 'accepted');
      await queue.markSynced(rejected.id, 'rejected');
      await queue.markSynced(ignored.id, 'ignored');

      expect(queue.findByIdempotencyKey('accepted-failure')).toBeUndefined();
      expect(queue.findByIdempotencyKey('rejected-failure')).toBeUndefined();
      expect(queue.findByIdempotencyKey('ignored-cancelled')).toBeUndefined();
      expect(queue.list()).toHaveLength(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('filters pending events and refuses local-only records', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      const offline = await queue.enqueue({
        idempotencyKey: 'offline-path-error',
        deviceID: 'device_1',
        eventType: LocalEventTypes.PATH_ERROR,
        resourceType: LocalResourceTypes.HOOK,
        resourceID: 'resource_hook',
        bindingID: 'binding_hook',
        agentID: 'codex',
        projectID: 'project_1',
        kitID: 'kit_1',
        result: 'FAILURE',
        offlineCreated: true,
        syncStatus: SyncStatuses.PENDING_SYNC,
        createdAt: '2026-06-16T00:00:00.000Z'
      });
      await expect(queue.enqueue({
        idempotencyKey: 'local-only-discovery',
        deviceID: 'device_1',
        eventType: LocalEventTypes.HOOK_DISCOVERED,
        resourceType: LocalResourceTypes.HOOK,
        resourceID: 'resource_hook',
        agentID: 'codex',
        offlineCreated: false,
        syncStatus: SyncStatuses.LOCAL_ONLY,
        createdAt: '2026-06-16T00:05:00.000Z'
      })).rejects.toThrow(/only stores offline sync records/);

      expect(offline.offlineCreated).toBe(true);
      expect(offline.syncStatus).toBe(SyncStatuses.PENDING_SYNC);
      expect(queue.listPending().map((event) => event.idempotencyKey)).toEqual(['offline-path-error']);
      expect(queue.list({ resourceType: LocalResourceTypes.HOOK })).toHaveLength(1);
      expect(queue.list({ agentID: 'codex', projectID: 'project_1' }).map((event) => event.id)).toEqual([offline.id]);
      expect(queue.list({ kitID: 'kit_1', eventType: LocalEventTypes.PATH_ERROR, result: 'FAILURE' }).map((event) => event.id)).toEqual([offline.id]);
      expect(queue.list({ offlineCreated: false })).toHaveLength(0);
      expect(queue.list({ syncStatus: SyncStatuses.PENDING_SYNC }).map((event) => event.id)).toEqual([offline.id]);
      expect(queue.list({ since: '2026-06-16T00:01:00.000Z' })).toHaveLength(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('rejects runtime Hook and CLI event names before persistence', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);

      await expect(queue.enqueue({ deviceID: 'device_1', eventType: 'CLI_COMMAND_EXECUTED' })).rejects.toThrow(/Runtime event type/);
      await expect(queue.enqueue({ deviceID: 'device_1', eventType: 'trigger-hook' })).rejects.toThrow(/Runtime event type/);
      expect(queue.list()).toHaveLength(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('does not persist repository-originated local-only inventory events', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      const repository = new LocalLifecycleRepository(db, queue);

      await repository.recordAgentEvent({
        eventType: LocalEventTypes.HOOK_DISCOVERED,
        resourceType: LocalResourceTypes.HOOK,
        sourceId: 'codex:hook:pre',
        agentId: 'codex',
        targetPath: '/tmp/hook.json',
        status: 'info',
        message: 'Hook config discovered',
        metadata: { token: 'raw-token-value' }
      });
      await repository.recordAgentEvent({
        eventType: LocalEventTypes.HOOK_DISCOVERED,
        resourceType: LocalResourceTypes.HOOK,
        sourceId: 'codex:hook:pre',
        agentId: 'codex',
        targetPath: '/tmp/hook.json',
        status: 'info',
        message: 'Hook config discovered',
        metadata: { token: 'raw-token-value' }
      });

      const events = queue.list({ eventType: LocalEventTypes.HOOK_DISCOVERED });
      expect(events).toHaveLength(0);
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});

import { LocalEventSyncService } from '../src/main/events/local-event-sync-service';

describe('LocalEventSyncService', () => {
  it('batch syncs pending events and marks missing acknowledgements retryable', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      const accepted = await queue.enqueue({ idempotencyKey: 'ack-key', deviceID: 'device_1', eventType: 'accepted.event' });
      const missing = await queue.enqueue({ idempotencyKey: 'missing-key', deviceID: 'device_1', eventType: 'missing.event' });
      const sync = new LocalEventSyncService(queue, async () => [{ idempotencyKey: accepted.idempotencyKey, result: 'accepted' }]);
      const summary = await sync.syncPending();
      expect(summary).toMatchObject({ attempted: 2, accepted: 1, failed: 1 });
      expect(queue.findByIdempotencyKey(accepted.idempotencyKey)).toBeUndefined();
      expect(queue.findByIdempotencyKey(missing.idempotencyKey)?.status).toBe('retryable');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
