import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureRequestID } from '../../shared/request-id';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';
import type { ApiClient, ClientUpdateInfo } from '../api/api-client';
import type { DeviceInfo } from '../config/device-id-store';
import { HashVerifier } from '../executor/hash-verifier';
import type { SignatureVerifier } from './signature-verifier';

export interface ClientUpdateLauncher {
  launchInstaller(filePath: string, update: ClientUpdateInfo, requestID?: string): Promise<void>;
}

export interface PendingClientUpdate {
  state: 'available' | 'download_confirmed' | 'verified' | 'cancelled' | 'launched';
  update: ClientUpdateInfo;
  installerPath?: string;
}

export interface ClientUpdateServiceOptions {
  apiClient: ApiClient;
  getDeviceInfo: () => Promise<DeviceInfo>;
  downloadsDir: string;
  startupStateFile?: string;
  signatureVerifier: SignatureVerifier;
  launcher: ClientUpdateLauncher;
  hashVerifier?: HashVerifier;
  platform?: string;
  arch?: string;
}

export class ClientUpdateService {
  private pending?: PendingClientUpdate;
  private readonly hashVerifier: HashVerifier;

  constructor(private readonly options: ClientUpdateServiceOptions) {
    this.hashVerifier = options.hashVerifier ?? new HashVerifier();
  }

  getPending(): PendingClientUpdate | undefined {
    return this.pending;
  }

  async reportStartupVersion(requestID?: string): Promise<{ reported: boolean; currentVersion: string; previousVersion?: string; skippedReason?: string }> {
    const device = await this.options.getDeviceInfo();
    const currentVersion = device.clientVersion ?? 'unknown';
    const state = await this.readStartupState();
    const previousVersion = state.lastReportedVersion;
    if (!previousVersion) {
      await this.writeStartupState({ lastReportedVersion: currentVersion });
      return { reported: false, currentVersion, skippedReason: 'initial_version_recorded' };
    }
    if (previousVersion === currentVersion) {
      return { reported: false, currentVersion, previousVersion, skippedReason: 'version_unchanged' };
    }
    await this.options.apiClient.reportClientUpdateEvents(device.deviceID, [{
      idempotencyKey: `UPDATED_FIRST_START:${device.deviceID}:${previousVersion}:${currentVersion}`,
      eventType: 'UPDATED_FIRST_START',
      result: 'SUCCESS',
      fromVersion: previousVersion,
      toVersion: currentVersion,
      requestID,
      payloadSummary: { previousVersion, currentVersion }
    }], requestID);
    await this.writeStartupState({ lastReportedVersion: currentVersion });
    return { reported: true, currentVersion, previousVersion };
  }

  async check(requestID?: string): Promise<PendingClientUpdate | undefined> {
    const resolvedRequestID = ensureRequestID(requestID);
    const device = await this.options.getDeviceInfo();
    const update = await this.options.apiClient.checkClientUpdate({
      deviceId: device.deviceID,
      currentVersion: device.clientVersion ?? 'unknown',
      platform: this.options.platform ?? process.platform,
      arch: this.options.arch ?? process.arch
    }, resolvedRequestID);
    if (!update.updateAvailable) {
      this.pending = undefined;
      return undefined;
    }
    this.pending = { state: 'available', update };
    await this.report(device.deviceID, 'UPDATE_AVAILABLE', 'success', undefined, resolvedRequestID, { version: update.version });
    return this.pending;
  }

  async cancel(reason = 'USER_CANCELLED', requestID?: string): Promise<PendingClientUpdate | undefined> {
    if (!this.pending) return undefined;
    const device = await this.options.getDeviceInfo();
    this.pending = { ...this.pending, state: 'cancelled' };
    await this.report(device.deviceID, 'USER_CANCELLED', 'cancelled', reason, requestID, { version: this.pending.update.version });
    return this.pending;
  }

  async confirmDownload(requestID?: string): Promise<PendingClientUpdate> {
    const resolvedRequestID = ensureRequestID(requestID);
    const pending = this.requireState(['available'], resolvedRequestID);
    const update = pending.update;
    if (!update.versionId || !update.version || !update.packageSha256) {
      throw new DesktopErrorException(makeDesktopError('validation_failed', 'Update metadata is incomplete', resolvedRequestID));
    }
    const device = await this.options.getDeviceInfo();
    await this.report(device.deviceID, 'DOWNLOAD_CONFIRMED', 'success', undefined, resolvedRequestID, { version: update.version });
    const ticket = await this.options.apiClient.createClientUpdateDownloadTicket({
      deviceId: device.deviceID,
      versionId: update.versionId,
      currentVersion: device.clientVersion
    }, resolvedRequestID);
    const bytes = await this.options.apiClient.downloadClientUpdate(ticket.ticket, resolvedRequestID);
    const installerPath = await this.writeUpdateFile(update.version, bytes);
    this.pending = { state: 'download_confirmed', update, installerPath };
    try {
      await this.hashVerifier.verifyFile(installerPath, update.packageSha256, resolvedRequestID);
      await this.options.signatureVerifier.verify({ filePath: installerPath, update, requestID: resolvedRequestID });
    } catch (error) {
      await this.report(device.deviceID, 'VERIFY_FAILED', 'failure', error instanceof DesktopErrorException ? error.desktopError.code : 'verification_failed', resolvedRequestID, { version: update.version });
      throw error;
    }
    this.pending = { state: 'verified', update, installerPath };
    await this.report(device.deviceID, 'VERIFIED', 'success', undefined, resolvedRequestID, { version: update.version });
    return this.pending;
  }

  async confirmInstall(requestID?: string): Promise<PendingClientUpdate> {
    const resolvedRequestID = ensureRequestID(requestID);
    const pending = this.requireState(['verified'], resolvedRequestID);
    if (!pending.installerPath) {
      throw new DesktopErrorException(makeDesktopError('update_confirmation_required', 'Verified installer is missing', resolvedRequestID));
    }
    const device = await this.options.getDeviceInfo();
    await this.report(device.deviceID, 'LAUNCH_CONFIRMED', 'success', undefined, resolvedRequestID, { version: pending.update.version });
    await this.options.launcher.launchInstaller(pending.installerPath, pending.update, resolvedRequestID);
    this.pending = { ...pending, state: 'launched' };
    await this.report(device.deviceID, 'INSTALLER_LAUNCHED', 'success', undefined, resolvedRequestID, { version: pending.update.version });
    return this.pending;
  }

  private requireState(states: PendingClientUpdate['state'][], requestID: string): PendingClientUpdate {
    if (!this.pending || !states.includes(this.pending.state)) {
      throw new DesktopErrorException(makeDesktopError('update_confirmation_required', 'Client update requires user confirmation before continuing', requestID));
    }
    return this.pending;
  }

  private async writeUpdateFile(version: string, bytes: ArrayBuffer): Promise<string> {
    await mkdir(this.options.downloadsDir, { recursive: true });
    const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(this.options.downloadsDir, `client-update-${safeVersion}-${Date.now()}.bin`);
    await writeFile(filePath, Buffer.from(bytes));
    return filePath;
  }

  private async readStartupState(): Promise<{ lastReportedVersion?: string }> {
    try {
      const parsed = JSON.parse(await readFile(this.startupStateFile(), 'utf8')) as Record<string, unknown>;
      return typeof parsed.lastReportedVersion === 'string'
        ? { lastReportedVersion: parsed.lastReportedVersion }
        : {};
    } catch {
      return {};
    }
  }

  private async writeStartupState(state: { lastReportedVersion: string }): Promise<void> {
    const file = this.startupStateFile();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  private startupStateFile(): string {
    return this.options.startupStateFile ?? path.join(this.options.downloadsDir, 'startup-state.json');
  }

  private report(deviceId: string, eventType: string, result: string, errorCode: string | undefined, requestID: string | undefined, payloadSummary: Record<string, unknown>): Promise<unknown> {
    return this.options.apiClient.reportClientUpdateEvents(deviceId, [{
      idempotencyKey: `${eventType}:${payloadSummary.version ?? 'unknown'}:${Date.now()}`,
      eventType,
      result,
      errorCode,
      requestID,
      payloadSummary
    }], requestID);
  }
}

export class ShellClientUpdateLauncher implements ClientUpdateLauncher {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async launchInstaller(filePath: string, _update: ClientUpdateInfo, requestID?: string): Promise<void> {
    if (this.platform !== 'win32') {
      throw new DesktopErrorException(makeDesktopError('installer_launch_failed', 'Client update installer launch is only available on Windows', requestID));
    }
    const escapedPath = filePath.replace(/'/g, "''");
    await new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process -FilePath '${escapedPath}'`], {
        stdio: 'ignore',
        windowsHide: true
      });
      child.once('error', (error) => {
        reject(new DesktopErrorException(makeDesktopError('installer_launch_failed', 'Client update installer launch failed', requestID, {
          message: error.message
        })));
      });
      child.once('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new DesktopErrorException(makeDesktopError('installer_launch_failed', 'Client update installer launch failed', requestID, { exitCode: code })));
      });
    });
  }
}
