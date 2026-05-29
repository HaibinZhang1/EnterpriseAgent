import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiClient } from '../api/api-client';
import type { AppPaths } from '../config/app-paths';
import { HashVerifier } from '../executor/hash-verifier';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

export class PackageDownloadService {
  private readonly hashVerifier = new HashVerifier();

  constructor(private readonly apiClient: Pick<ApiClient, 'downloadPackage'>, private readonly paths: AppPaths) {}

  async downloadToTemp(ticket: string, fileName: string, requestID?: string): Promise<string> {
    await mkdir(this.paths.tempDir, { recursive: true });
    const safeName = path.basename(fileName);
    const target = path.join(this.paths.tempDir, safeName);
    try {
      const bytes = await this.apiClient.downloadPackage(ticket, requestID);
      await writeFile(target, Buffer.from(bytes));
    } catch (error) {
      if (error instanceof DesktopErrorException) throw error;
      throw new DesktopErrorException(makeDesktopError('download_failed', 'Package download failed', requestID, error));
    }
    return target;
  }

  async downloadAndVerify(input: { ticket: string; fileName: string; expectedSha256?: string; requestID?: string }): Promise<string> {
    const target = await this.downloadToTemp(input.ticket, input.fileName, input.requestID);
    if (input.expectedSha256) {
      try {
        await this.hashVerifier.verifyFile(target, input.expectedSha256);
      } catch (error) {
        throw new DesktopErrorException(makeDesktopError('local_hash_mismatch', 'Downloaded package hash mismatch', input.requestID, error));
      }
    }
    return target;
  }
}
