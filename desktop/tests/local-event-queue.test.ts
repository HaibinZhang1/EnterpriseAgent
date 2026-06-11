import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalEventQueue } from '../src/main/events/local-event-queue';
import { tempRoot } from './test-utils';

describe('LocalEventQueue', () => {
  it('persists events, returns existing rows for duplicate idempotency keys, and redacts payloads', async () => {
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
      expect(reopenedQueue.findByIdempotencyKey('dup-key')?.status).toBe('accepted');
      await reopened.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('preserves the original business result when sync is accepted rejected or ignored', async () => {
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

      expect(queue.findByIdempotencyKey('accepted-failure')).toMatchObject({ status: 'accepted', result: 'FAILURE' });
      expect(queue.findByIdempotencyKey('rejected-failure')).toMatchObject({ status: 'rejected', result: 'FAILURE' });
      expect(queue.findByIdempotencyKey('ignored-cancelled')).toMatchObject({ status: 'ignored', result: 'CANCELLED' });
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
      expect(queue.findByIdempotencyKey(accepted.idempotencyKey)?.status).toBe('accepted');
      expect(queue.findByIdempotencyKey(missing.idempotencyKey)?.status).toBe('retryable');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
