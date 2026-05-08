import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { AdapterMatchRequest, ToolAdapter } from './types';
import { validateAdapterManifest } from './manifest';

export class AdapterRegistry {
  private readonly adapters = new Map<string, ToolAdapter>();

  register(adapter: ToolAdapter): void {
    validateAdapterManifest(adapter.manifest);
    this.adapters.set(adapter.manifest.adapterId, adapter);
  }

  list(): ToolAdapter[] {
    return [...this.adapters.values()];
  }

  match(request: AdapterMatchRequest): ToolAdapter[] {
    return this.list().filter((adapter) => adapter.canHandle(request));
  }

  explainNoMatch(request: AdapterMatchRequest): string {
    const names = this.list().map((adapter) => adapter.manifest.adapterId).join(', ') || 'none';
    return `No adapter matched ${request.extensionKind} on ${request.platform} for capabilities ${request.requiredCapabilities.join(', ')}. Registered adapters: ${names}`;
  }
}

export function createCapabilityMatcher(manifestCapabilities: string[], required: string[]): boolean {
  return required.every((capability) => manifestCapabilities.includes(capability));
}

export interface AdapterScanResult {
  adapterId: string;
  path: string;
  exists: boolean;
}

export class AdapterScanner {
  constructor(private readonly roots: string[]) {}

  async scan(adapter: ToolAdapter): Promise<AdapterScanResult[]> {
    const manifest = validateAdapterManifest(adapter.manifest);
    const roots = this.roots.map((root) => path.resolve(root));
    const paths = manifest.defaultScanPaths.map((item) => path.resolve(item));
    const safePaths = paths.filter((item) => roots.some((root) => item === root || item.startsWith(`${root}${path.sep}`)));
    const results: AdapterScanResult[] = [];
    for (const candidate of safePaths) {
      results.push({ adapterId: manifest.adapterId, path: candidate, exists: await exists(candidate) });
    }
    return results;
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch {
    return false;
  }
}
