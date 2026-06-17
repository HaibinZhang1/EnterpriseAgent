import { makeDesktopError, type DesktopError } from '../../shared/errors';

export type OfflineOperation =
  | 'catalog.read'
  | 'extension.detail.read'
  | 'local.viewInstalled'
  | 'local.disable.entry'
  | 'local.uninstall.entry'
  | 'local.cleanup.entry'
  | 'local.scan.agents'
  | 'local.scan.custom-directory'
  | 'local.scan.settings'
  | 'local.scan.rules'
  | 'local.scan.memory'
  | 'local.scan.subagents'
  | 'local.scan.ignore'
  | 'local.scan.hook'
  | 'local.scan.cli'
  | 'local.cached.skill.view'
  | 'local.cached.mcp.view'
  | 'local.cached.plugin.view'
  | 'local.file.preview'
  | 'local.static-audit'
  | 'local.path-check'
  | 'local.drift-check'
  | 'local.settings.write'
  | 'local.rules.write'
  | 'local.memory.write'
  | 'local.subagents.write'
  | 'local.ignore.write'
  | 'hook.config.enable'
  | 'hook.config.disable'
  | 'cli.config.register'
  | 'cli.config.enable'
  | 'cli.config.disable'
  | 'kit.local.import'
  | 'kit.local.audit'
  | 'kit.local.preview'
  | 'local.resource.apply-existing'
  | 'local.resource.disable'
  | 'local.resource.uninstall'
  | 'local.resource.cleanup'
  | 'skill.enable.installed'
  | 'extension.install'
  | 'extension.download'
  | 'mcp.connect'
  | 'mcp.config.write'
  | 'mcp.update'
  | 'plugin.install'
  | 'plugin.download'
  | 'plugin.update'
  | 'skill.install.new'
  | 'mcp.server.new'
  | 'plugin.download.new'
  | 'plugin.install.new'
  | 'mcp.server.copy-config'
  | 'update.check'
  | 'update.download'
  | 'authorization.refresh'
  | 'event.sync'
  | 'client.update';

export interface OfflineSkillEnableDecisionInput {
  installed: boolean;
  hasValidAuthorizationCache: boolean;
  scopesMatch: boolean;
  scopeReduced?: boolean;
  delisted?: boolean;
  securityRisk?: boolean;
}

export interface OfflineExistingResourceDecisionInput {
  presentOnDisk: boolean;
  hasValidAuthorizationCache: boolean;
  scopesMatch: boolean;
  scopeReduced?: boolean;
  delisted?: boolean;
  securityRisk?: boolean;
  hashMismatch?: boolean;
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
  'local.cleanup.entry',
  'local.scan.agents',
  'local.scan.custom-directory',
  'local.scan.settings',
  'local.scan.rules',
  'local.scan.memory',
  'local.scan.subagents',
  'local.scan.ignore',
  'local.scan.hook',
  'local.scan.cli',
  'local.cached.skill.view',
  'local.cached.mcp.view',
  'local.cached.plugin.view',
  'local.file.preview',
  'local.static-audit',
  'local.path-check',
  'local.drift-check',
  'local.settings.write',
  'local.rules.write',
  'local.memory.write',
  'local.subagents.write',
  'local.ignore.write',
  'hook.config.enable',
  'hook.config.disable',
  'cli.config.register',
  'cli.config.enable',
  'cli.config.disable',
  'kit.local.import',
  'kit.local.audit',
  'kit.local.preview',
  'local.resource.apply-existing',
  'local.resource.disable',
  'local.resource.uninstall',
  'local.resource.cleanup'
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

  decideApplyExistingLocalResource(context: OfflineExistingResourceDecisionInput, online: boolean, requestID?: string): OfflineDecision {
    if (online) return { allowed: true, reason: 'online' };
    const allowed = context.presentOnDisk
      && context.hasValidAuthorizationCache
      && context.scopesMatch
      && !context.scopeReduced
      && !context.delisted
      && !context.securityRisk
      && !context.hashMismatch;
    if (allowed) return { allowed: true, reason: 'offline_existing_resource_with_valid_cache' };
    return {
      allowed: false,
      reason: 'offline_existing_resource_not_trusted',
      error: makeDesktopError('offline_authorization_required', 'Offline apply requires an existing local resource with valid cached authorization, matching scopes, and clean hash/security state', requestID)
    };
  }
}
