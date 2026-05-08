import { DesktopErrorException, makeDesktopError } from '../../shared/errors';
import type { AdapterCapability, AdapterManifest } from './types';

const CAPABILITIES = new Set<AdapterCapability>(['symlink', 'copy', 'config-write', 'controlled-install', 'connection-test', 'dry-run', 'rollback']);

export function validateAdapterManifest(manifest: AdapterManifest, requestID?: string): AdapterManifest {
  if (!manifest.adapterId || !manifest.adapterVersion || !manifest.toolName || !Array.isArray(manifest.supportedPlatforms)) {
    throw new DesktopErrorException(makeDesktopError('adapter_manifest_invalid', 'Adapter manifest is missing required identity fields', requestID));
  }
  if (!Array.isArray(manifest.defaultScanPaths) || manifest.defaultScanPaths.some((item) => item.includes('..'))) {
    throw new DesktopErrorException(makeDesktopError('adapter_manifest_invalid', 'Adapter scan paths must be explicit and configurable', requestID));
  }
  for (const capability of manifest.capabilities) {
    if (!CAPABILITIES.has(capability)) {
      throw new DesktopErrorException(makeDesktopError('adapter_manifest_invalid', `Unsupported adapter capability ${capability}`, requestID));
    }
  }
  return manifest;
}
