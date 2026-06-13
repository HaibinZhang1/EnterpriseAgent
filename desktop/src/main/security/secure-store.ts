import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

export type SecureStoreKey = 'session.token' | `mcp.variable.${string}` | `mcp.managed-config.${string}` | `api.secret.${string}`;

export interface SecureStore {
  get(key: SecureStoreKey): Promise<string | undefined>;
  set(key: SecureStoreKey, value: string): Promise<void>;
  delete(key: SecureStoreKey): Promise<void>;
  getStartupSessionState?(): Promise<{ hasSession: boolean; hasStoredSession?: boolean; message?: string }>;
}

export class MemorySecureStore implements SecureStore {
  private readonly values = new Map<SecureStoreKey, string>();

  async get(key: SecureStoreKey): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: SecureStoreKey, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: SecureStoreKey): Promise<void> {
    this.values.delete(key);
  }

  async getStartupSessionState(): Promise<{ hasSession: boolean }> {
    return { hasSession: this.values.has('session.token') };
  }
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface SecureStoreFile {
  entries: Record<string, { encrypted: string; updatedAt: string }>;
}

export class SafeStorageSecureStore implements SecureStore {
  constructor(private readonly filePath: string, private readonly safeStorage: SafeStorageLike) {}

  async get(key: SecureStoreKey): Promise<string | undefined> {
    const file = await this.readFile();
    const entry = file.entries[key];
    if (!entry) return undefined;
    this.assertAvailable();
    try {
      return this.safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64'));
    } catch (error) {
      throw this.corrupted('Secure store entry cannot be decrypted', error);
    }
  }

  async set(key: SecureStoreKey, value: string): Promise<void> {
    this.assertAvailable();
    const file = await this.readFile();
    file.entries[key] = {
      encrypted: this.encrypt(value),
      updatedAt: new Date().toISOString()
    };
    await this.writeFile(file);
  }

  async delete(key: SecureStoreKey): Promise<void> {
    this.assertAvailable();
    const file = await this.readFile();
    delete file.entries[key];
    await this.writeFile(file);
  }

  async getStartupSessionState(): Promise<{ hasSession: false; hasStoredSession: boolean; message?: string }> {
    const file = await this.readFile();
    const hasStoredSession = Boolean(file.entries['session.token']);
    return {
      hasSession: false,
      hasStoredSession,
      message: hasStoredSession ? '已跳过旧本地会话自动恢复，请重新登录。' : undefined
    };
  }

  private assertAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new DesktopErrorException(makeDesktopError('secure_store_unavailable', 'Secure storage encryption is unavailable'));
    }
  }

  private async readFile(): Promise<SecureStoreFile> {
    try {
      return this.validateFile(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch (error) {
      if (isMissingFileError(error)) {
        return { entries: {} };
      }
      if (error instanceof DesktopErrorException) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw this.corrupted('Secure store file is corrupted', error);
      }
      throw this.unavailable('Secure store file cannot be read', error);
    }
  }

  private validateFile(value: unknown): SecureStoreFile {
    if (!value || typeof value !== 'object') {
      throw this.corrupted('Secure store file has invalid shape');
    }
    const entries = (value as { entries?: unknown }).entries;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw this.corrupted('Secure store file has invalid entries');
    }
    for (const entry of Object.values(entries as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') {
        throw this.corrupted('Secure store entry has invalid shape');
      }
      const record = entry as { encrypted?: unknown; updatedAt?: unknown };
      if (typeof record.encrypted !== 'string' || typeof record.updatedAt !== 'string') {
        throw this.corrupted('Secure store entry is missing encrypted data');
      }
    }
    return { entries: entries as SecureStoreFile['entries'] };
  }

  private encrypt(value: string): string {
    try {
      return this.safeStorage.encryptString(value).toString('base64');
    } catch (error) {
      throw this.unavailable('Secure store encryption failed', error);
    }
  }

  private async writeFile(file: SecureStoreFile): Promise<void> {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    } catch (error) {
      throw this.unavailable('Secure store file cannot be written', error);
    }
  }

  private corrupted(message: string, cause?: unknown): DesktopErrorException {
    return new DesktopErrorException(makeDesktopError('secure_store_corrupted', message, undefined, errorDetails(cause)));
  }

  private unavailable(message: string, cause?: unknown): DesktopErrorException {
    return new DesktopErrorException(makeDesktopError('secure_store_unavailable', message, undefined, errorDetails(cause)));
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function errorDetails(error: unknown): Record<string, unknown> | undefined {
  return error instanceof Error ? { message: error.message } : undefined;
}
