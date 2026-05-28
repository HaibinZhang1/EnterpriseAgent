import type { DesktopError } from '../../shared/errors';

export type AppTab = 'agent' | 'community' | 'local';
export type LocalTab = 'extensions' | 'tools' | 'projects';
export type ExtensionKind = 'skill' | 'mcp' | 'plugin';
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface UiError {
  code?: string;
  message: string;
  requestID?: string;
  details?: unknown;
}

export interface SessionUser {
  userId?: string;
  username?: string;
  displayName?: string;
  role?: string;
  mustChangePassword?: boolean;
}

export interface DeviceSummary {
  deviceID?: string;
  clientVersion?: string;
  osVersion?: string;
  arch?: string;
}

export interface OfflineState {
  online: boolean;
  checkedAt?: string;
  reason?: string;
  installDecision?: {
    allowed?: boolean;
    reason?: string;
    error?: DesktopError;
  };
}

export interface ExtensionSummary {
  id: string;
  type: ExtensionKind;
  name: string;
  summary?: string;
  description?: string;
  version?: string;
  publisher?: string;
  tags: string[];
  starCount?: number;
  downloadCount?: number;
  usageCount?: number;
  starred?: boolean;
  authorized?: boolean;
  authorizationMessage?: string;
  status?: string;
  riskLevel?: string;
  visibilityMode?: string;
  updatedAt?: string;
}

export interface CatalogHome {
  skills: ExtensionSummary[];
  mcps: ExtensionSummary[];
  plugins: ExtensionSummary[];
  hot: ExtensionSummary[];
  stars: ExtensionSummary[];
  downloads: ExtensionSummary[];
}

export interface VersionSummary {
  version: string;
  status?: string;
  createdAt?: string;
}

export interface DetailState {
  state: LoadState;
  error?: UiError;
  item?: ExtensionSummary;
  raw?: unknown;
  versions: VersionSummary[];
}

export interface LocalLifecycleSnapshot {
  extensions: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  targets: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  mcpInstallations: Array<Record<string, unknown>>;
  pluginInstallations: Array<Record<string, unknown>>;
}

export interface LocalInventoryScanSummary {
  scannedAt?: string;
  discovered?: {
    skills?: number;
    plugins?: number;
    mcpConfigs?: number;
    tools?: number;
    projects?: number;
    total?: number;
  };
}

export interface PendingEvent {
  id?: string;
  idempotencyKey?: string;
  extensionID?: string;
  eventType?: string;
  result?: string;
  status?: string;
  errorCode?: string;
  createdAt?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message?: string;
  read?: boolean;
  createdAt?: string;
  severity?: string;
}

export interface PublishResult {
  submissionId?: string;
  revisionId?: string;
  status?: string;
}

export interface UpdateState {
  state?: string;
  version?: string;
  releaseNotes?: string;
  force?: boolean;
  error?: UiError;
}
