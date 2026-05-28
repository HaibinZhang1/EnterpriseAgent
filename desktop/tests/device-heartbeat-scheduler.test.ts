import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../src/main/api/api-client';
import { DeviceHeartbeatScheduler } from '../src/main/device/device-heartbeat-scheduler';
import { DeviceRegistrationService } from '../src/main/device/device-registration-service';

describe('DeviceHeartbeatScheduler', () => {
  it('starts an immediate heartbeat and can be stopped', async () => {
    const calls: string[] = [];
    const scheduler = new DeviceHeartbeatScheduler(async (requestID) => {
      calls.push(requestID ?? '');
    }, { immediate: true, intervalMs: 60_000, requestIDPrefix: 'test_heartbeat' });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.stop();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^test_heartbeat_startup_/);
  });

  it('keeps heartbeat errors contained', async () => {
    const errors: unknown[] = [];
    const scheduler = new DeviceHeartbeatScheduler(async () => {
      throw new Error('offline');
    }, { onError: (error) => {
      errors.push(error);
    } });

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

describe('DeviceRegistrationService', () => {
  it('sends current client version and local event queue size in heartbeats', async () => {
    const payloads: unknown[] = [];
    const apiClient = {
      heartbeat: async (payload: unknown) => {
        payloads.push(payload);
        return { accepted: true };
      }
    } as unknown as ApiClient;
    const service = new DeviceRegistrationService(
      apiClient,
      async () => ({ deviceID: 'device_1', clientVersion: '0.1.0-m8', createdAt: 'now', updatedAt: 'now' }),
      () => 3
    );

    await service.heartbeat('req_heartbeat');

    expect(payloads[0]).toEqual({ deviceId: 'device_1', clientVersion: '0.1.0-m8', localEventQueueSize: 3 });
  });
});
