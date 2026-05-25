import type { ApiClient } from '../api/api-client';
import type { DeviceInfo } from '../config/device-id-store';

export class DeviceRegistrationService {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly getDeviceInfo: () => Promise<DeviceInfo>
  ) {}

  async register(requestID?: string): Promise<unknown> {
    const device = await this.getDeviceInfo();
    return this.apiClient.registerDevice(device, requestID);
  }

  async heartbeat(requestID?: string): Promise<unknown> {
    const device = await this.getDeviceInfo();
    return this.apiClient.heartbeat({
      deviceId: device.deviceID,
      clientVersion: device.clientVersion ?? 'unknown'
    }, requestID);
  }
}
