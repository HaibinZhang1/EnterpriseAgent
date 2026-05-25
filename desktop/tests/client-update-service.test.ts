import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ApiClient, ClientUpdateInfo } from '../src/main/api/api-client';
import { DesktopErrorException, makeDesktopError } from '../src/shared/errors';
import type { ClientUpdateLauncher } from '../src/main/update/client-update-service';
import { ClientUpdateService, ShellClientUpdateLauncher } from '../src/main/update/client-update-service';
import type { SignatureVerifier } from '../src/main/update/signature-verifier';
import { WindowsAuthenticodeSignatureVerifier } from '../src/main/update/signature-verifier';
import { tempRoot } from './test-utils';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('ClientUpdateService', () => {
  it('requires user download confirmation before tickets and launch confirmation before installer launch', async () => {
    const temp = await tempRoot();
    try {
      const packageBytes = bytes('update package');
      const update: ClientUpdateInfo = {
        updateAvailable: true,
        versionId: 'version-1',
        version: '0.1.0-m8',
        packageSha256: createHash('sha256').update(packageBytes).digest('hex'),
        signature: { status: 'VALID' }
      };
      const calls: string[] = [];
      const apiClient = {
        checkClientUpdate: async () => {
          calls.push('check');
          return update;
        },
        createClientUpdateDownloadTicket: async () => {
          calls.push('ticket');
          return { ticket: 'ticket-secret' };
        },
        downloadClientUpdate: async () => {
          calls.push('download');
          return packageBytes.buffer.slice(packageBytes.byteOffset, packageBytes.byteOffset + packageBytes.byteLength);
        },
        reportClientUpdateEvents: async (_deviceID: string, events: Array<{ eventType: string }>) => {
          calls.push(`event:${events[0].eventType}`);
          return { accepted: true };
        }
      } as unknown as ApiClient;
      const launcher: ClientUpdateLauncher = {
        launchInstaller: async () => {
          calls.push('launch');
        }
      };
      const signatureVerifier: SignatureVerifier = {
        verify: async () => {
          calls.push('signature');
        }
      };
      const service = new ClientUpdateService({
        apiClient,
        getDeviceInfo: async () => ({ deviceID: 'device_1', clientVersion: '0.1.0-m7', createdAt: 'now', updatedAt: 'now' }),
        downloadsDir: temp.root,
        signatureVerifier,
        launcher,
        platform: 'win32',
        arch: 'x64'
      });

      await expect(service.check('req_check')).resolves.toMatchObject({ state: 'available' });
      expect(calls).toEqual(['check', 'event:UPDATE_AVAILABLE']);
      await expect(service.confirmInstall('req_install_early')).rejects.toMatchObject({ desktopError: { code: 'update_confirmation_required' } });
      expect(calls).not.toContain('launch');

      await expect(service.confirmDownload('req_confirm')).resolves.toMatchObject({ state: 'verified' });
      expect(calls).toEqual(['check', 'event:UPDATE_AVAILABLE', 'event:DOWNLOAD_CONFIRMED', 'ticket', 'download', 'signature', 'event:VERIFIED']);
      expect(calls).not.toContain('launch');

      await expect(service.confirmInstall('req_install')).resolves.toMatchObject({ state: 'launched' });
      expect(calls.slice(-3)).toEqual(['event:LAUNCH_CONFIRMED', 'launch', 'event:INSTALLER_LAUNCHED']);
    } finally {
      await temp.cleanup();
    }
  });

  it('reports cancel without requesting a ticket', async () => {
    const calls: string[] = [];
    const apiClient = {
      checkClientUpdate: async () => ({ updateAvailable: true, versionId: 'version-1', version: '0.1.0-m8', packageSha256: '0'.repeat(64), signature: { status: 'VALID' } }),
      createClientUpdateDownloadTicket: async () => {
        calls.push('ticket');
        return { ticket: 'ticket-secret' };
      },
      reportClientUpdateEvents: async (_deviceID: string, events: Array<{ eventType: string }>) => {
        calls.push(`event:${events[0].eventType}`);
        return { accepted: true };
      }
    } as unknown as ApiClient;
    const service = new ClientUpdateService({
      apiClient,
      getDeviceInfo: async () => ({ deviceID: 'device_1', clientVersion: '0.1.0-m7', createdAt: 'now', updatedAt: 'now' }),
      downloadsDir: '/tmp',
      signatureVerifier: { verify: async () => undefined },
      launcher: { launchInstaller: async () => undefined }
    });

    await service.check('req_check');
    await expect(service.cancel('USER_CANCELLED', 'req_cancel')).resolves.toMatchObject({ state: 'cancelled' });
    expect(calls).toEqual(['event:UPDATE_AVAILABLE', 'event:USER_CANCELLED']);
  });

  it('reports hash failures and does not run signature or launcher', async () => {
    const temp = await tempRoot();
    try {
      const calls: string[] = [];
      const apiClient = {
        checkClientUpdate: async () => ({ updateAvailable: true, versionId: 'version-1', version: '0.1.0-m8', packageSha256: createHash('sha256').update('expected').digest('hex'), signature: { status: 'VALID' } }),
        createClientUpdateDownloadTicket: async () => ({ ticket: 'ticket-secret' }),
        downloadClientUpdate: async () => bytes('actual').buffer,
        reportClientUpdateEvents: async (_deviceID: string, events: Array<{ eventType: string }>) => {
          calls.push(`event:${events[0].eventType}`);
          return { accepted: true };
        }
      } as unknown as ApiClient;
      const service = new ClientUpdateService({
        apiClient,
        getDeviceInfo: async () => ({ deviceID: 'device_1', clientVersion: '0.1.0-m7', createdAt: 'now', updatedAt: 'now' }),
        downloadsDir: temp.root,
        signatureVerifier: { verify: async () => { calls.push('signature'); } },
        launcher: { launchInstaller: async () => { calls.push('launch'); } }
      });

      await service.check('req_check');
      await expect(service.confirmDownload('req_confirm')).rejects.toMatchObject({ desktopError: { code: 'hash_mismatch' } });
      expect(calls).toEqual(['event:UPDATE_AVAILABLE', 'event:DOWNLOAD_CONFIRMED', 'event:VERIFY_FAILED']);
    } finally {
      await temp.cleanup();
    }
  });

  it('reports signature failures and does not launch installer', async () => {
    const temp = await tempRoot();
    try {
      const packageBytes = bytes('update package');
      const calls: string[] = [];
      const apiClient = {
        checkClientUpdate: async () => ({
          updateAvailable: true,
          versionId: 'version-1',
          version: '0.1.0-m8',
          packageSha256: createHash('sha256').update(packageBytes).digest('hex'),
          signature: { status: 'INVALID' }
        }),
        createClientUpdateDownloadTicket: async () => ({ ticket: 'ticket-secret' }),
        downloadClientUpdate: async () => packageBytes.buffer.slice(packageBytes.byteOffset, packageBytes.byteOffset + packageBytes.byteLength),
        reportClientUpdateEvents: async (_deviceID: string, events: Array<{ eventType: string }>) => {
          calls.push(`event:${events[0].eventType}`);
          return { accepted: true };
        }
      } as unknown as ApiClient;
      const service = new ClientUpdateService({
        apiClient,
        getDeviceInfo: async () => ({ deviceID: 'device_1', clientVersion: '0.1.0-m7', createdAt: 'now', updatedAt: 'now' }),
        downloadsDir: temp.root,
        signatureVerifier: {
          verify: async () => {
            calls.push('signature');
            throw new DesktopErrorException(makeDesktopError('signature_verification_failed', 'invalid signature', 'req_confirm'));
          }
        },
        launcher: { launchInstaller: async () => { calls.push('launch'); } }
      });

      await service.check('req_check');
      await expect(service.confirmDownload('req_confirm')).rejects.toMatchObject({ desktopError: { code: 'signature_verification_failed' } });
      expect(calls).toEqual(['event:UPDATE_AVAILABLE', 'event:DOWNLOAD_CONFIRMED', 'signature', 'event:VERIFY_FAILED']);
    } finally {
      await temp.cleanup();
    }
  });

  it('fails closed when default local signature verification is unavailable', async () => {
    const verifier = new WindowsAuthenticodeSignatureVerifier({ platform: 'darwin' });

    await expect(verifier.verify({
      filePath: '/tmp/update.exe',
      update: { updateAvailable: true, signature: { status: 'VALID' } },
      requestID: 'req_signature'
    })).rejects.toMatchObject({ desktopError: { code: 'signature_verification_failed' } });
  });

  it('does not report installer launched when the default launcher cannot run', async () => {
    const calls: string[] = [];
    const service = new ClientUpdateService({
      apiClient: {
        reportClientUpdateEvents: async (_deviceID: string, events: Array<{ eventType: string }>) => {
          calls.push(`event:${events[0].eventType}`);
          return { accepted: true };
        }
      } as unknown as ApiClient,
      getDeviceInfo: async () => ({ deviceID: 'device_1', clientVersion: '0.1.0-m7', createdAt: 'now', updatedAt: 'now' }),
      downloadsDir: '/tmp',
      signatureVerifier: { verify: async () => undefined },
      launcher: new ShellClientUpdateLauncher('darwin')
    });
    (service as unknown as { pending: unknown }).pending = {
      state: 'verified',
      update: { updateAvailable: true, version: '0.1.0-m8' },
      installerPath: '/tmp/update.exe'
    };

    await expect(service.confirmInstall('req_install')).rejects.toMatchObject({ desktopError: { code: 'installer_launch_failed' } });
    expect(calls).toEqual(['event:LAUNCH_CONFIRMED']);
  });
});
