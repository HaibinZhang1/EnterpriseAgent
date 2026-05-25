import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';
import type { ClientUpdateInfo } from '../api/api-client';

const execFileAsync = promisify(execFile);

export interface SignatureVerificationInput {
  filePath: string;
  update: ClientUpdateInfo;
  requestID?: string;
}

export interface SignatureVerifier {
  verify(input: SignatureVerificationInput): Promise<void>;
}

export interface WindowsAuthenticodeSignatureVerifierOptions {
  platform?: NodeJS.Platform;
  powershellPath?: string;
}

interface AuthenticodeResult {
  Status?: string;
  StatusMessage?: string;
  Thumbprint?: string;
  Subject?: string;
}

export class WindowsAuthenticodeSignatureVerifier implements SignatureVerifier {
  private readonly platform: NodeJS.Platform;
  private readonly powershellPath: string;

  constructor(options: WindowsAuthenticodeSignatureVerifierOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.powershellPath = options.powershellPath ?? 'powershell.exe';
  }

  async verify(input: SignatureVerificationInput): Promise<void> {
    if (input.update.signature?.status !== 'VALID') {
      throw new DesktopErrorException(makeDesktopError('signature_verification_failed', 'Client update signature is not trusted', input.requestID));
    }
    if (this.platform !== 'win32') {
      throw new DesktopErrorException(makeDesktopError('signature_verification_failed', 'Client update Authenticode verification is only available on Windows', input.requestID));
    }
    const result = await this.readAuthenticodeSignature(input.filePath, input.requestID);
    if (String(result.Status ?? '').toUpperCase() !== 'VALID') {
      throw new DesktopErrorException(makeDesktopError('signature_verification_failed', 'Client update Authenticode signature is invalid', input.requestID, {
        status: result.Status,
        statusMessage: result.StatusMessage
      }));
    }
    const expectedThumbprint = input.update.signature?.certificateThumbprint?.trim().toUpperCase();
    const actualThumbprint = result.Thumbprint?.trim().toUpperCase();
    if (expectedThumbprint && expectedThumbprint !== actualThumbprint) {
      throw new DesktopErrorException(makeDesktopError('signature_verification_failed', 'Client update certificate thumbprint does not match server metadata', input.requestID));
    }
  }

  private async readAuthenticodeSignature(filePath: string, requestID?: string): Promise<AuthenticodeResult> {
    const escapedPath = filePath.replace(/'/g, "''");
    const command = [
      `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
      "$signature | Select-Object Status,StatusMessage,@{Name='Thumbprint';Expression={$_.SignerCertificate.Thumbprint}},@{Name='Subject';Expression={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress"
    ].join('; ');
    try {
      const { stdout } = await execFileAsync(this.powershellPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      return JSON.parse(String(stdout).trim()) as AuthenticodeResult;
    } catch (error) {
      throw new DesktopErrorException(makeDesktopError('signature_verification_failed', 'Client update Authenticode verification failed', requestID, {
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }
}
