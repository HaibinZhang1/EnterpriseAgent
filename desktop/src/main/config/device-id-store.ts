import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { AppPaths } from './app-paths';

export interface DeviceInfo {
  deviceID: string;
  createdAt: string;
  updatedAt: string;
  clientVersion?: string;
}

export class DeviceIdStore {
  constructor(private readonly paths: AppPaths, private readonly clientVersion = '0.1.0-m6') {}

  async getOrCreate(): Promise<DeviceInfo> {
    const existing = await this.readExisting();
    if (existing) return existing;
    const now = new Date().toISOString();
    const info: DeviceInfo = {
      deviceID: `device_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      clientVersion: this.clientVersion
    };
    await writeFile(this.paths.deviceFile, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
    return info;
  }

  private async readExisting(): Promise<DeviceInfo | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.paths.deviceFile, 'utf8')) as Partial<DeviceInfo>;
      if (typeof parsed.deviceID === 'string' && parsed.deviceID.length > 0) {
        return {
          deviceID: parsed.deviceID,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          updatedAt: parsed.updatedAt ?? parsed.createdAt ?? new Date().toISOString(),
          clientVersion: parsed.clientVersion ?? this.clientVersion
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
