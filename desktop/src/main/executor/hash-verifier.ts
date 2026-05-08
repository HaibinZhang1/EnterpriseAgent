import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export class HashVerifier {
  async verifyFile(filePath: string, expectedSha256: string, requestID?: string): Promise<void> {
    if (!SHA256_PATTERN.test(expectedSha256)) {
      throw new DesktopErrorException(makeDesktopError('hash_mismatch', 'Expected SHA-256 is malformed', requestID));
    }
    const actual = createHash('sha256').update(await readFile(filePath)).digest('hex');
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new DesktopErrorException(makeDesktopError('hash_mismatch', 'File hash does not match the registered SHA-256', requestID));
    }
  }
}
