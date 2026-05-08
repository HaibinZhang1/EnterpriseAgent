import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiClient } from '../api/api-client';
import type { AppPaths } from '../config/app-paths';

export class PackageDownloadService {
  constructor(private readonly apiClient: Pick<ApiClient, 'downloadPackage'>, private readonly paths: AppPaths) {}

  async downloadToTemp(ticket: string, fileName: string, requestID?: string): Promise<string> {
    await mkdir(this.paths.tempDir, { recursive: true });
    const safeName = path.basename(fileName);
    const target = path.join(this.paths.tempDir, safeName);
    const bytes = await this.apiClient.downloadPackage(ticket, requestID);
    await writeFile(target, Buffer.from(bytes));
    return target;
  }
}
