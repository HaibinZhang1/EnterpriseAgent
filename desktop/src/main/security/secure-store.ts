import { readFile, writeFile } from 'node:fs/promises';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

export type SecureStoreKey = 'session.token' | `mcp.variable.${string}` | `api.secret.${string}`;

export interface SecureStore {
  get(key: SecureStoreKey): Promise<string | undefined>;
  set(key: SecureStoreKey, value: string): Promise<void>;
  delete(key: SecureStoreKey): Promise<void>;
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
    return this.safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64'));
  }

  async set(key: SecureStoreKey, value: string): Promise<void> {
    this.assertAvailable();
    const file = await this.readFile();
    file.entries[key] = {
      encrypted: this.safeStorage.encryptString(value).toString('base64'),
      updatedAt: new Date().toISOString()
    };
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }

  async delete(key: SecureStoreKey): Promise<void> {
    const file = await this.readFile();
    delete file.entries[key];
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }

  private assertAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new DesktopErrorException(makeDesktopError('secure_store_unavailable', 'Secure storage encryption is unavailable'));
    }
  }

  private async readFile(): Promise<SecureStoreFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as SecureStoreFile;
    } catch {
      return { entries: {} };
    }
  }
}
