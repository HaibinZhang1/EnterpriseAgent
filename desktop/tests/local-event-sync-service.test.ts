import { describe, expect, it } from 'vitest';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalEventQueue } from '../src/main/events/local-event-queue';
import { LocalEventSyncService, mapServerLocalEventStatus } from '../src/main/events/local-event-sync-service';
import { tempRoot } from './test-utils';

describe('LocalEventSyncService M7 status mapping', () => {
  it('maps uppercase server statuses to lowercase local states and carries server state hints', async () => {
    expect(mapServerLocalEventStatus('ACCEPTED')).toBe('accepted');
    expect(mapServerLocalEventStatus('IGNORED')).toBe('ignored');
    expect(mapServerLocalEventStatus('REJECTED')).toBe('rejected');
    expect(() => mapServerLocalEventStatus('accepted')).toThrow(/Unsupported/);

    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      const event = await queue.enqueue({ idempotencyKey: 'ack-upper', deviceID: 'device_1', eventType: 'skill.install' });
      const sync = new LocalEventSyncService(queue, async () => ({ acknowledgements: [{ idempotencyKey: event.idempotencyKey, result: 'accepted' }], serverStateHints: [{ extensionId: 'ext', state: 'SCOPE_REDUCED' }] }));
      const summary = await sync.syncPending();
      expect(summary.accepted).toBe(1);
      expect(summary.serverStateHints[0].state).toBe('SCOPE_REDUCED');
      expect(queue.findByIdempotencyKey('ack-upper')).toBeUndefined();
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('marks pending events retryable when transport fails', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      await queue.enqueue({ idempotencyKey: 'will-fail', deviceID: 'device_1', eventType: 'skill.install' });
      const sync = new LocalEventSyncService(queue, async () => { throw new Error('network down'); });
      const summary = await sync.syncPending();
      expect(summary.failed).toBe(1);
      expect(queue.findByIdempotencyKey('will-fail')?.status).toBe('retryable');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
