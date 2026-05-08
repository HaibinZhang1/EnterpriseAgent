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
