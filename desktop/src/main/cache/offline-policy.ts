import { makeDesktopError, type DesktopError } from '../../shared/errors';

export type OfflineOperation =
  | 'catalog.read'
  | 'extension.detail.read'
  | 'local.viewInstalled'
  | 'local.disable.entry'
  | 'local.uninstall.entry'
  | 'local.cleanup.entry'
  | 'skill.enable.installed'
  | 'extension.install'
  | 'extension.download'
  | 'mcp.connect'
  | 'mcp.config.write'
  | 'mcp.update'
  | 'plugin.install'
  | 'plugin.download'
  | 'plugin.update'
  | 'client.update';

export interface OfflineSkillEnableDecisionInput {
  installed: boolean;
  hasValidAuthorizationCache: boolean;
  scopesMatch: boolean;
  scopeReduced?: boolean;
  delisted?: boolean;
  securityRisk?: boolean;
}

export interface OfflineDecision {
  allowed: boolean;
  reason: string;
  error?: DesktopError;
}

const OFFLINE_ALLOWED = new Set<OfflineOperation>([
  'catalog.read',
  'extension.detail.read',
  'local.viewInstalled',
  'local.disable.entry',
  'local.uninstall.entry',
  'local.cleanup.entry'
]);

export class OfflinePolicy {
  decide(operation: OfflineOperation, online: boolean, requestID?: string): OfflineDecision {
    if (online) return { allowed: true, reason: 'online' };
    if (OFFLINE_ALLOWED.has(operation)) {
      return { allowed: true, reason: 'offline_cached_or_local_entry' };
    }
    return {
      allowed: false,
      reason: 'server_authority_required',
      error: makeDesktopError('offline_server_authority_required', `${operation} requires server authority while offline`, requestID)
    };
  }

  decideSkillEnableInstalled(context: OfflineSkillEnableDecisionInput, online: boolean, requestID?: string): OfflineDecision {
    if (online) return { allowed: true, reason: 'online' };
    const allowed = context.installed
      && context.hasValidAuthorizationCache
      && context.scopesMatch
      && !context.scopeReduced
      && !context.delisted
      && !context.securityRisk;
    if (allowed) return { allowed: true, reason: 'offline_valid_authorization_cache' };
    return {
      allowed: false,
      reason: 'offline_cached_authorization_invalid',
      error: makeDesktopError('offline_authorization_required', 'Valid cached authorization is required to enable an installed Skill while offline', requestID)
    };
  }
}
