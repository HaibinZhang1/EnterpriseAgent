import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AuditStatuses,
  createEmptyPermissionSummary,
  LocalEventTypes,
  LocalResourceSourceTypes,
  LocalResourceTypes,
  OperationStatuses,
  PermissionCategories,
  PermissionItems,
  ResourceScopeTypes,
  type AuditSummary,
  type LocalResourceType,
  type PermissionCategory,
  type PermissionItem,
  type PermissionSummary,
  type ResourceScopeType
} from '../../shared/local-resources';
import { resourceTypesForAgentResourceKind } from '../../shared/agent-resource-taxonomy';
import { auditStaticResource } from '../../shared/local-audit';
import type { LocalLifecycleRepository } from '../lifecycle/local-lifecycle-repository';
import type { AgentResourceKind } from '../tool-adapters/types';
import { CUSTOM_AGENT_ID, listAgentCatalog, resolveAgentPathProfile, type AgentPathProfileInput, type CustomAgentProfile } from './agent-catalog';

export interface AgentInventoryScannerOptions extends AgentPathProfileInput {
  includeMissingPaths?: boolean;
  maxPreviewBytes?: number;
  customProfiles?: readonly CustomAgentProfile[];
  projectId?: string;
}

export interface AgentInventoryScanSummary {
  scannedAt: string;
  agents: number;
  resources: number;
  missingPaths: number;
  failures: number;
}

interface CandidatePath {
  kind: AgentResourceKind;
  path: string;
  fromPattern: string;
}

interface HookDeclaration {
  event: string;
  matcher?: string;
  command: string;
}

interface McpDeclaration {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface CodexPluginManifestIdentity {
  marketplace: string;
  pluginName: string;
  version: string;
  manifestPath: string;
  pluginKey: string;
}

const kindLabels: Record<AgentResourceKind, string> = {
  settings: 'Settings',
  rules: 'Rules',
  memory: 'Memory',
  subagents: 'Subagents',
  'ignore-files': 'Ignore Files',
  skills: 'Skill',
  mcp: 'MCP',
  plugins: 'Plugin',
  hooks: 'Hook',
  cli: 'CLI',
  files: 'Files'
};

export class AgentInventoryScanner {
  private readonly includeMissingPaths: boolean;
  private readonly maxPreviewBytes: number;

  constructor(
    private readonly lifecycleRepository: LocalLifecycleRepository,
    private readonly options: AgentInventoryScannerOptions
  ) {
    this.includeMissingPaths = options.includeMissingPaths ?? true;
    this.maxPreviewBytes = options.maxPreviewBytes ?? 256 * 1024;
  }

  private customProfileMetadataFor(agentId: string): Record<string, unknown> {
    const profile = (this.options.customProfiles ?? []).find((item) => item.agentId === agentId);
    if (!profile) return {};
    return {
      customProfileId: profile.profileId,
      ...(profile.targetAgentId ? { targetAgentId: profile.targetAgentId, attachedToBuiltInAgent: true } : {})
    };
  }

  async scan(): Promise<AgentInventoryScanSummary> {
    const scannedAt = new Date().toISOString();
    let resources = 0;
    let missingPaths = 0;
    let failures = 0;
    await this.lifecycleRepository.deleteAgentInventoryResourcesByKinds(['files', 'hooks', 'cli']);
    const catalog = listAgentCatalog(this.options.customProfiles ?? []);
    for (const manifest of catalog) {
      const platformProfile = this.options.platform === 'windows' ? manifest.windowsPathProfile : manifest.macosPathProfile;
      if (!platformProfile) continue;
      const profile = resolveAgentPathProfile(platformProfile, this.options);
      const detectionRoot = profile.detectionRoots.find((item) => !hasUnresolvedToken(item)) ?? profile.fallbackRoot;
      const rootState = await existsAny(profile.detectionRoots);
      const rootExists = rootState.exists;
      const isCustom = !manifest.builtIn || manifest.agentId === CUSTOM_AGENT_ID;
      const sourceType = isCustom ? LocalResourceSourceTypes.CUSTOM_DIRECTORY : LocalResourceSourceTypes.NATIVE_AGENT_DIRECTORY;
      const agentScope = this.projectScopeFor(detectionRoot);
      await this.lifecycleRepository.recordAgentResource({
        resourceType: LocalResourceTypes.AGENT,
        sourceId: manifest.agentId,
        name: manifest.displayName,
        agentId: manifest.agentId,
        projectId: agentScope.projectId,
        scopeType: agentScope.scopeType,
        targetPath: detectionRoot,
        status: rootState.errors.length > 0 ? 'scan_failed' : rootExists ? 'scanned' : 'not_configured',
        sourceType,
        nativeDirectoryManaged: !isCustom,
        eaManagedFallback: Boolean(profile.fallbackRoot),
        metadata: {
          builtIn: manifest.builtIn,
          ...this.customProfileMetadataFor(manifest.agentId),
          capabilities: manifest.capabilities,
          pathProfile: profile,
          projectId: agentScope.projectId,
          projectRoot: agentScope.projectId ? this.options.projectRoot : undefined,
          customProfileConfigured: isCustom && rootExists,
          missingReason: rootExists ? undefined : isCustom ? 'Agent Profile 未配置或未验证' : '检测根不存在或需用户配置',
          rootErrors: rootState.errors
        }
      });
      resources += 1;
      if (rootState.errors.length > 0) {
        failures += rootState.errors.length;
        for (const error of rootState.errors) {
          await this.recordPathFailure(manifest.agentId, manifest.displayName, {
            kind: 'settings',
            path: error.path,
            fromPattern: error.path
          }, error.error, '检测根访问失败', sourceType);
        }
      }
      if (!rootExists && !this.options.projectRoot) {
        continue;
      }
      const { candidates, failures: expansionFailures } = await expandResourceCandidates(profile.resourcePaths ?? {});
      failures += expansionFailures.length;
      for (const failure of expansionFailures) {
        await this.recordPathFailure(manifest.agentId, manifest.displayName, failure.candidate, failure.error, '路径模式展开失败', sourceType);
      }
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (candidate.kind === 'files') continue;
        if (seen.has(`${candidate.kind}:${candidate.path}`)) continue;
        seen.add(`${candidate.kind}:${candidate.path}`);
        if (hasUnresolvedToken(candidate.path)) continue;
        const current = await pathState(candidate.path);
        if (current.error) {
          failures += 1;
          await this.recordPathFailure(manifest.agentId, manifest.displayName, candidate, current.error, '路径状态检查失败', sourceType);
          continue;
        }
        if (!current.exists) {
          const tracked = await this.lifecycleRepository.checkTrackedResourcePathByTargetPath(candidate.path);
          if (tracked) {
            missingPaths += 1;
            continue;
          }
          if (this.includeMissingPaths) {
            missingPaths += 1;
            await this.recordMissingPath(manifest.agentId, manifest.displayName, candidate, sourceType);
          }
          continue;
        }
        try {
          resources += await this.recordExistingPath(manifest.agentId, manifest.displayName, candidate, current.isDirectory, sourceType);
        } catch (error) {
          failures += 1;
          await this.lifecycleRepository.recordScanFailure({
            path: candidate.path,
            code: error instanceof SyntaxError ? 'config_parse_failed' : 'agent_scan_failed',
            message: error instanceof Error ? error.message : 'Agent resource scan failed',
            resourceType: resourceTypeForKind(candidate.kind),
            sourceType,
            agentId: manifest.agentId,
            projectId: this.projectIdFor(candidate.path),
            operationStatus: OperationStatuses.IDLE,
            metadata: { agentId: manifest.agentId, ...this.customProfileMetadataFor(manifest.agentId), kind: candidate.kind, pattern: candidate.fromPattern }
          });
        }
      }
    }
    return { scannedAt, agents: catalog.length, resources, missingPaths, failures };
  }

  private async recordMissingPath(agentId: string, displayName: string, candidate: CandidatePath, sourceType: typeof LocalResourceSourceTypes[keyof typeof LocalResourceSourceTypes]): Promise<void> {
    const resourceType = resourceTypeForKind(candidate.kind);
    const sourceId = `${agentId}:${candidate.kind}:${candidate.fromPattern}`;
    const projectScope = this.projectScopeFor(candidate.path);
    await this.lifecycleRepository.recordAgentResource({
      resourceType,
      sourceId,
      name: `${displayName} ${kindLabels[candidate.kind]}`,
      agentId,
      projectId: projectScope.projectId,
      scopeType: projectScope.scopeType,
      targetPath: candidate.path,
      status: 'not_configured',
      sourceType,
      nativeDirectoryManaged: sourceType === LocalResourceSourceTypes.NATIVE_AGENT_DIRECTORY,
      metadata: {
        kind: candidate.kind,
        ...this.customProfileMetadataFor(agentId),
        pattern: candidate.fromPattern,
        projectId: projectScope.projectId,
        pathStatusReason: '路径缺失或未配置'
      }
    });
    await this.lifecycleRepository.recordAgentEvent({
      eventType: LocalEventTypes.PATH_ERROR,
      resourceType,
      sourceId,
      agentId,
      projectId: projectScope.projectId,
      targetPath: candidate.path,
      status: 'failure',
      message: `未找到 ${displayName} ${kindLabels[candidate.kind]} 路径`,
      errorCode: 'path_missing',
      failureReason: '路径缺失或未配置',
      suggestion: '配置路径后重新扫描。',
      metadata: { kind: candidate.kind, ...this.customProfileMetadataFor(agentId), pattern: candidate.fromPattern, projectId: projectScope.projectId }
    });
  }

  private async recordPathFailure(agentId: string, displayName: string, candidate: CandidatePath, error: unknown, reason: string, sourceType: typeof LocalResourceSourceTypes[keyof typeof LocalResourceSourceTypes]): Promise<void> {
    const resourceType = resourceTypeForKind(candidate.kind);
    const code = errorCode(error);
    const sourceId = `scan-failure:${code}:${candidate.path}`;
    const projectScope = this.projectScopeFor(candidate.path);
    await this.lifecycleRepository.recordScanFailure({
      path: candidate.path,
      code,
      message: `${reason}: ${error instanceof Error ? error.message : String(error)}`,
      resourceType,
      sourceType,
      agentId,
      projectId: projectScope.projectId,
      operationStatus: OperationStatuses.IDLE,
      metadata: {
        kind: candidate.kind,
        ...this.customProfileMetadataFor(agentId),
        pattern: candidate.fromPattern,
        projectId: projectScope.projectId,
        pathStatusReason: reason,
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
    await this.lifecycleRepository.recordAgentEvent({
      eventType: LocalEventTypes.PATH_ERROR,
      resourceType,
      sourceId,
      agentId,
      projectId: projectScope.projectId,
      targetPath: candidate.path,
      status: 'failure',
      message: `${displayName} ${kindLabels[candidate.kind]} 路径访问失败`,
      errorCode: code,
      failureReason: reason,
      suggestion: '检查路径是否存在、是否为目录/文件，以及当前用户是否有读取权限。',
      metadata: { kind: candidate.kind, ...this.customProfileMetadataFor(agentId), pattern: candidate.fromPattern, projectId: projectScope.projectId }
    });
  }

  private async recordExistingPath(agentId: string, displayName: string, candidate: CandidatePath, isDirectory: boolean, sourceType: typeof LocalResourceSourceTypes[keyof typeof LocalResourceSourceTypes]): Promise<number> {
    const files = isDirectory ? await listDirectoryFiles(candidate.path) : [candidate.path];
    let count = 0;
    for (const filePath of files) {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() && !fileStat.isDirectory()) continue;
      const resourceType = resourceTypeForKind(candidate.kind);
      const content = fileStat.isFile() && fileStat.size <= this.maxPreviewBytes ? await readFile(filePath, 'utf8') : '';
      validateStaticParse(filePath, content);
      if (candidate.kind === 'hooks') {
        if (!fileStat.isFile()) continue;
        count += await this.recordHookDeclarations(agentId, candidate, filePath, content, sourceType);
        continue;
      }
      if (candidate.kind === 'mcp') {
        if (!fileStat.isFile()) continue;
        count += await this.recordMcpDeclarations(agentId, candidate, filePath, content, sourceType);
        continue;
      }
      const resourceName = resourceNameForCandidate(candidate, filePath, content, displayName);
      const permissionSummary = extractPermissionSummary(resourceType, filePath, content);
      const sourceId = `${agentId}:${candidate.kind}:${stablePathId(filePath)}`;
      const resourceId = resourceIdFor(resourceType, sourceId);
      const bindingId = bindingIdFor(resourceId, filePath);
      const projectScope = this.projectScopeFor(filePath);
      const auditResult = content
        ? auditStaticResource({
          resourceId,
          bindingId,
          resourceType,
          name: resourceName,
          path: filePath,
          content,
          agentId,
          projectId: projectScope.projectId,
          permissionSummary,
          metadata: {
            kind: candidate.kind,
            ...this.customProfileMetadataFor(agentId),
            pattern: candidate.fromPattern,
            projectId: projectScope.projectId,
            staticOnly: true
          }
        })
        : undefined;
      const auditSummary = auditResult?.summary ?? auditSummaryFor(resourceType, permissionSummary, filePath, content);
      await this.lifecycleRepository.recordAgentResource({
        resourceType,
        sourceId,
        name: resourceName,
        agentId,
        projectId: projectScope.projectId,
        scopeType: projectScope.scopeType,
        targetPath: filePath,
        status: auditSummary.status === AuditStatuses.HIGH_RISK ? 'high_risk' : 'scanned',
        sourceType,
        nativeDirectoryManaged: sourceType === LocalResourceSourceTypes.NATIVE_AGENT_DIRECTORY,
        permissionSummary,
        auditSummary,
        metadata: {
          kind: candidate.kind,
          ...this.customProfileMetadataFor(agentId),
          pattern: candidate.fromPattern,
          projectId: projectScope.projectId,
          previewAvailable: fileStat.isFile() && fileStat.size <= this.maxPreviewBytes,
          version: versionFromMetadata(filePath, content) ?? '版本未知',
          versionReason: versionFromMetadata(filePath, content) ? undefined : '未在 manifest、配置或文件属性中读取到版本',
          staticOnly: true
        }
      });
      await this.lifecycleRepository.upsertAuditRunFindings(auditResult?.runId ?? `audit_empty_${stablePathId(filePath)}`, auditResult?.findings ?? [], [{ resourceId, bindingId }]);
      await this.lifecycleRepository.recordAgentEvent({
        eventType: eventTypeForKind(candidate.kind),
        resourceType,
        sourceId,
        agentId,
        projectId: projectScope.projectId,
        targetPath: filePath,
        status: 'info',
        message: `${displayName} ${kindLabels[candidate.kind]} 已静态发现`,
        metadata: { kind: candidate.kind, ...this.customProfileMetadataFor(agentId), pattern: candidate.fromPattern, projectId: projectScope.projectId }
      });
      count += 1;
    }
    return count;
  }

  private async recordHookDeclarations(agentId: string, candidate: CandidatePath, filePath: string, content: string, sourceType: typeof LocalResourceSourceTypes[keyof typeof LocalResourceSourceTypes]): Promise<number> {
    const hooks = extractHookDeclarations(filePath, content);
    let count = 0;
    for (const hook of hooks) {
      const resourceType = LocalResourceTypes.HOOK;
      const hookName = `${hook.event}:${hook.matcher ?? '*'}:${hook.command}`;
      const sourceId = `${agentId}:hooks:${stablePathId(filePath)}:${stablePathId(hookName)}`;
      const resourceId = resourceIdFor(resourceType, sourceId);
      const bindingId = bindingIdFor(resourceId, filePath);
      const projectScope = this.projectScopeFor(filePath);
      const permissionSummary = extractPermissionSummary(resourceType, filePath, hook.command);
      const auditResult = auditStaticResource({
        resourceId,
        bindingId,
        resourceType,
        name: hookName,
        path: filePath,
        content: hook.command,
        agentId,
        projectId: projectScope.projectId,
        permissionSummary,
        metadata: {
          kind: candidate.kind,
          ...this.customProfileMetadataFor(agentId),
          pattern: candidate.fromPattern,
          projectId: projectScope.projectId,
          hookEvent: hook.event,
          hookMatcher: hook.matcher,
          command: hook.command,
          sourceConfigPath: filePath,
          staticOnly: true
        }
      });
      const auditSummary = auditResult.summary;
      await this.lifecycleRepository.recordAgentResource({
        resourceType,
        sourceId,
        name: hookName,
        agentId,
        projectId: projectScope.projectId,
        scopeType: projectScope.scopeType,
        targetPath: filePath,
        status: auditSummary.status === AuditStatuses.HIGH_RISK ? 'high_risk' : 'scanned',
        sourceType,
        nativeDirectoryManaged: sourceType === LocalResourceSourceTypes.NATIVE_AGENT_DIRECTORY,
        permissionSummary,
        auditSummary,
        metadata: {
          kind: candidate.kind,
          ...this.customProfileMetadataFor(agentId),
          pattern: candidate.fromPattern,
          projectId: projectScope.projectId,
          hookEvent: hook.event,
          hookMatcher: hook.matcher,
          command: hook.command,
          sourceConfigPath: filePath,
          previewAvailable: false,
          version: '版本未知',
          versionReason: 'Hook 条目来自配置文件解析，不声明独立版本',
          staticOnly: true
        }
      });
      await this.lifecycleRepository.upsertAuditRunFindings(auditResult.runId, auditResult.findings, [{ resourceId, bindingId }]);
      await this.lifecycleRepository.recordAgentEvent({
        eventType: LocalEventTypes.HOOK_DISCOVERED,
        resourceType,
        sourceId,
        agentId,
        projectId: projectScope.projectId,
        targetPath: filePath,
        status: 'info',
        message: 'Hook 已从配置条目静态发现',
        metadata: {
          kind: candidate.kind,
          ...this.customProfileMetadataFor(agentId),
          pattern: candidate.fromPattern,
          projectId: projectScope.projectId,
          hookEvent: hook.event,
          hookMatcher: hook.matcher,
          command: hook.command,
          sourceConfigPath: filePath
        }
      });
      count += 1;
    }
    return count;
  }

  private async recordMcpDeclarations(agentId: string, candidate: CandidatePath, filePath: string, content: string, sourceType: typeof LocalResourceSourceTypes[keyof typeof LocalResourceSourceTypes]): Promise<number> {
    const declarations = extractMcpDeclarations(filePath, content);
    let count = 0;
    for (const declaration of declarations) {
      const resourceType = LocalResourceTypes.MCP_SERVER;
      const permissionSummary = extractPermissionSummary(resourceType, filePath, `${declaration.command}\n${declaration.args.join('\n')}\n${Object.keys(declaration.env).join('\n')}`);
      const sourceId = `${agentId}:mcp:${stablePathId(filePath)}:${stablePathId(declaration.name)}`;
      const resourceId = resourceIdFor(resourceType, sourceId);
      const bindingId = bindingIdFor(resourceId, filePath);
      const projectScope = this.projectScopeFor(filePath);
      const auditResult = auditStaticResource({
        resourceId,
        bindingId,
        resourceType,
        name: declaration.name,
        path: filePath,
        content,
        agentId,
        projectId: projectScope.projectId,
        permissionSummary,
        metadata: {
          kind: 'mcp',
          ...this.customProfileMetadataFor(agentId),
          pattern: candidate.fromPattern,
          projectId: projectScope.projectId,
          command: declaration.command,
          args: declaration.args,
          env: declaration.env,
          staticOnly: true
        }
      });
      await this.lifecycleRepository.recordAgentResource({
        resourceType,
        sourceId,
        name: declaration.name,
        agentId,
        projectId: projectScope.projectId,
        scopeType: projectScope.scopeType,
        targetPath: filePath,
        status: auditResult.summary.status === AuditStatuses.HIGH_RISK ? 'high_risk' : 'scanned',
        sourceType,
        nativeDirectoryManaged: sourceType === LocalResourceSourceTypes.NATIVE_AGENT_DIRECTORY,
        permissionSummary,
        auditSummary: auditResult.summary,
        metadata: {
          kind: 'mcp',
          ...this.customProfileMetadataFor(agentId),
          pattern: candidate.fromPattern,
          projectId: projectScope.projectId,
          command: declaration.command,
          args: declaration.args,
          env: declaration.env,
          sourceConfigPath: filePath,
          staticOnly: true
        }
      });
      await this.lifecycleRepository.upsertAuditRunFindings(auditResult.runId, auditResult.findings, [{ resourceId, bindingId }]);
      await this.lifecycleRepository.recordAgentEvent({
        eventType: LocalEventTypes.MCP_DISCOVERED,
        resourceType,
        sourceId,
        agentId,
        projectId: projectScope.projectId,
        targetPath: filePath,
        status: 'info',
        message: `${agentId} MCP ${declaration.name} 已静态发现`,
        metadata: { kind: 'mcp', ...this.customProfileMetadataFor(agentId), pattern: candidate.fromPattern, projectId: projectScope.projectId, sourceConfigPath: filePath }
      });
      count += 1;
    }
    return count;
  }

  private projectIdFor(targetPath?: string): string | undefined {
    return this.projectScopeFor(targetPath).projectId;
  }

  private projectScopeFor(targetPath?: string): { projectId?: string; scopeType?: ResourceScopeType } {
    if (!this.options.projectId || !this.options.projectRoot || !targetPath) return {};
    if (!isInsideOrEqual(this.options.projectRoot, targetPath)) return {};
    return { projectId: this.options.projectId, scopeType: ResourceScopeTypes.AGENT_PROJECT };
  }
}

async function expandResourceCandidates(resourcePaths: Partial<Record<AgentResourceKind, string[]>>): Promise<{ candidates: CandidatePath[]; failures: Array<{ candidate: CandidatePath; error: unknown }> }> {
  const candidates: CandidatePath[] = [];
  const failures: Array<{ candidate: CandidatePath; error: unknown }> = [];
  for (const [kind, paths] of Object.entries(resourcePaths) as Array<[AgentResourceKind, string[] | undefined]>) {
    for (const item of paths ?? []) {
      if (hasUnresolvedToken(item)) {
        candidates.push({ kind, path: item, fromPattern: item });
        continue;
      }
      const { paths: expanded, error } = await expandPattern(item);
      if (error) {
        failures.push({ candidate: { kind, path: item, fromPattern: item }, error });
        continue;
      }
      if (expanded.length === 0) candidates.push({ kind, path: item, fromPattern: item });
      else candidates.push(...expanded.map((filePath) => ({ kind, path: filePath, fromPattern: item })));
    }
  }
  return { candidates: dedupeCodexPluginCandidates(candidates), failures };
}

function dedupeCodexPluginCandidates(candidates: CandidatePath[]): CandidatePath[] {
  const grouped = new Map<string, { candidate: CandidatePath; identity: CodexPluginManifestIdentity }>();
  const output: CandidatePath[] = [];
  for (const candidate of candidates) {
    const identity = codexPluginManifestIdentity(candidate);
    if (!identity) {
      output.push(candidate);
      continue;
    }
    const existing = grouped.get(identity.pluginKey);
    if (!existing || compareHarnessKitVersionDesc(identity.version, existing.identity.version) < 0) {
      grouped.set(identity.pluginKey, { candidate, identity });
    }
  }
  output.push(...[...grouped.values()].map((item) => item.candidate));
  return output;
}

function codexPluginManifestIdentity(candidate: CandidatePath): CodexPluginManifestIdentity | undefined {
  if (candidate.kind !== 'plugins') return undefined;
  const parts = path.normalize(candidate.path).split(/[\\/]+/);
  const index = parts.findIndex((part, current) => part === '.codex' && parts[current + 1] === 'plugins' && parts[current + 2] === 'cache');
  if (index < 0 || parts[index + 6] !== '.codex-plugin' || parts[index + 7] !== 'plugin.json') return undefined;
  const marketplace = parts[index + 3] ?? '';
  const pluginName = parts[index + 4] ?? '';
  const version = parts[index + 5] ?? '';
  if (!marketplace || !pluginName || !version) return undefined;
  return {
    marketplace,
    pluginName,
    version,
    manifestPath: candidate.path,
    pluginKey: parts.slice(0, index + 5).join('\0')
  };
}

function compareHarnessKitVersionDesc(a: string, b: string): number {
  const semverA = parseSimpleSemver(a);
  const semverB = parseSimpleSemver(b);
  if (semverA && semverB) {
    for (let index = 0; index < semverA.length; index += 1) {
      if (semverA[index] !== semverB[index]) return semverB[index] - semverA[index];
    }
    return 0;
  }
  return b.localeCompare(a);
}

function parseSimpleSemver(value: string): [number, number, number] | undefined {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function expandPattern(pattern: string): Promise<{ paths: string[]; error?: unknown }> {
  if (!pattern.includes('*')) return { paths: [pattern] };
  const firstStar = pattern.indexOf('*');
  const base = path.resolve(pattern.slice(0, firstStar).replace(/[\\/][^\\/]*$/, ''));
  const regex = globToRegExp(path.resolve(pattern));
  try {
    const files = await walkFiles(base, 8);
    return { paths: files.filter((filePath) => regex.test(path.resolve(filePath))) };
  } catch (error) {
    if (isMissingFileError(error)) return { paths: [] };
    return { paths: [], error };
  }
}

async function walkFiles(directory: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    let state: Awaited<ReturnType<typeof stat>>;
    try {
      state = await stat(filePath);
    } catch {
      continue;
    }
    if (state.isDirectory()) files.push(...await walkFiles(filePath, depth - 1));
    else if (state.isFile()) files.push(filePath);
  }
  return files;
}

async function listDirectoryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    try {
      if ((await stat(filePath)).isFile()) files.push(filePath);
    } catch {
      continue;
    }
  }
  if (files.length > 0) return files;
  const nestedFiles = await walkFiles(directory, 4);
  return nestedFiles.length > 0 ? nestedFiles : [directory];
}

async function pathState(filePath: string): Promise<{ exists: boolean; isDirectory: boolean; error?: unknown }> {
  try {
    const value = await stat(filePath);
    return { exists: true, isDirectory: value.isDirectory() };
  } catch (error) {
    if (isMissingFileError(error)) return { exists: false, isDirectory: false };
    return { exists: false, isDirectory: false, error };
  }
}

async function existsAny(paths: string[]): Promise<{ exists: boolean; errors: Array<{ path: string; error: unknown }> }> {
  const errors: Array<{ path: string; error: unknown }> = [];
  for (const filePath of paths) {
    if (hasUnresolvedToken(filePath)) continue;
    const current = await pathState(filePath);
    if (current.exists) return { exists: true, errors };
    if (current.error) errors.push({ path: filePath, error: current.error });
  }
  return { exists: false, errors };
}

function resourceTypeForKind(kind: AgentResourceKind): LocalResourceType {
  return resourceTypesForAgentResourceKind(kind)[0] ?? LocalResourceTypes.AGENT_CONFIG;
}

function resourceNameForCandidate(candidate: CandidatePath, filePath: string, content: string, displayName: string): string {
  if (candidate.kind === 'skills') return skillNameForPath(filePath, content);
  return path.basename(filePath) || `${displayName} ${kindLabels[candidate.kind]}`;
}

function skillNameForPath(filePath: string, content: string): string {
  return parseSkillFrontmatterName(content) ?? skillFallbackName(filePath);
}

function parseSkillFrontmatterName(content: string): string | undefined {
  if (!content.startsWith('---')) return undefined;
  const rest = content.slice(3);
  const end = rest.indexOf('---');
  if (end < 0) return undefined;
  const frontmatter = rest.slice(0, end);
  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('name:')) continue;
    const name = trimmed.slice('name:'.length).trim();
    if (name) return name;
  }
  return undefined;
}

function skillFallbackName(filePath: string): string {
  const basename = path.basename(filePath);
  if (/^SKILL\.md(?:\.disabled)?$/i.test(basename)) return path.basename(path.dirname(filePath));
  if (/\.md$/i.test(basename)) return path.basename(filePath, path.extname(filePath));
  return basename;
}

function eventTypeForKind(kind: AgentResourceKind): typeof LocalEventTypes[keyof typeof LocalEventTypes] {
  switch (kind) {
    case 'rules': return LocalEventTypes.RULE_DISCOVERED;
    case 'memory': return LocalEventTypes.MEMORY_DISCOVERED;
    case 'subagents': return LocalEventTypes.SUBAGENT_DISCOVERED;
    case 'ignore-files': return LocalEventTypes.IGNORE_DISCOVERED;
    case 'skills': return LocalEventTypes.SKILL_DISCOVERED;
    case 'mcp': return LocalEventTypes.MCP_DISCOVERED;
    case 'plugins': return LocalEventTypes.PLUGIN_DISCOVERED;
    case 'hooks': return LocalEventTypes.HOOK_DISCOVERED;
    case 'cli': return LocalEventTypes.CLI_DISCOVERED;
    default: return LocalEventTypes.CONFIG_DISCOVERED;
  }
}

function extractPermissionSummary(resourceType: LocalResourceType, filePath: string, content: string): PermissionSummary {
  const categories = new Set<PermissionCategory>([PermissionCategories.FILESYSTEM]);
  const items = new Set<PermissionItem>([PermissionItems.FILE_READ]);
  const details: PermissionSummary['details'] = [{ category: PermissionCategories.FILESYSTEM, item: PermissionItems.FILE_READ, label: '读取本地配置文件', target: filePath, riskLevel: 'info' }];
  if (/(command|shell|bash|zsh|powershell|cmd\.exe|\.sh|\.ps1|\.bat|\.cmd)/i.test(content)) {
    categories.add(PermissionCategories.SHELL);
    items.add(PermissionItems.SHELL_COMMAND);
    details.push({ category: PermissionCategories.SHELL, item: PermissionItems.SHELL_COMMAND, label: '声明本地命令或脚本配置', target: filePath, riskLevel: 'high' });
  }
  if (/https?:\/\//i.test(content)) {
    categories.add(PermissionCategories.NETWORK);
    items.add(PermissionItems.NETWORK_DOMAIN);
    details.push({ category: PermissionCategories.NETWORK, item: PermissionItems.NETWORK_DOMAIN, label: '声明网络访问配置', target: filePath, riskLevel: 'medium' });
  }
  if (/(api[_-]?key|token|secret|password|\\.env)/i.test(`${filePath}\n${content}`)) {
    categories.add(PermissionCategories.SECRET);
    categories.add(PermissionCategories.ENVIRONMENT);
    items.add(PermissionItems.SECRET_ACCESS);
    items.add(PermissionItems.ENV_READ);
    details.push({ category: PermissionCategories.SECRET, item: PermissionItems.SECRET_ACCESS, label: '包含敏感变量或凭据引用', target: filePath, riskLevel: 'high' });
  }
  return {
    categories: [...categories],
    items: [...items],
    label: details.length > 1 ? '已提取静态权限' : createEmptyPermissionSummary().label,
    declared: details.length > 1,
    details,
    lastExtractedAt: new Date().toISOString()
  };
}

function auditSummaryFor(resourceType: LocalResourceType, permissionSummary: PermissionSummary, filePath: string, content: string): AuditSummary {
  if (!content && filePath) return { status: AuditStatuses.NOT_AUDITED, findingCount: 0, criticalCount: 0, highCount: 0, message: '目录或不可预览文件未运行内容审计。' };
  return auditStaticResource({
    resourceId: `scan-preview:${resourceType}:${stablePathId(filePath)}`,
    resourceType,
    name: path.basename(filePath),
    path: filePath,
    content,
    permissionSummary,
    metadata: {
      scannedBy: 'agent_inventory_scanner',
      staticOnly: true
    }
  }).summary;
}

function validateStaticParse(filePath: string, content: string): void {
  if (!content) return;
  if (filePath.endsWith('.json')) JSON.parse(content);
}

function extractHookDeclarations(filePath: string, content: string): HookDeclaration[] {
  if (!content.trim()) return [];
  if (filePath.endsWith('.json')) return extractJsonHookDeclarations(JSON.parse(content));
  if (/\.(ya?ml)$/i.test(filePath)) return extractYamlHookDeclarations(content);
  return [];
}

function extractMcpDeclarations(filePath: string, content: string): McpDeclaration[] {
  if (!content.trim()) return [];
  if (filePath.endsWith('.json')) return extractJsonMcpDeclarations(JSON.parse(content));
  if (/\.toml$/i.test(filePath)) return extractTomlMcpDeclarations(content);
  return [];
}

function extractJsonMcpDeclarations(value: unknown): McpDeclaration[] {
  const root = asObject(value);
  const servers = asObject(root?.mcpServers) ?? asObject(root?.mcp_servers) ?? asObject(root?.servers);
  if (!servers) return [];
  return Object.entries(servers).flatMap(([name, raw]) => {
    const server = asObject(raw);
    if (!server) return [];
    const command = typeof server.command === 'string' ? server.command : '';
    return [{
      name,
      command,
      args: arrayify(server.args).filter((item): item is string => typeof item === 'string'),
      env: stringRecord(server.env)
    }];
  });
}

function extractTomlMcpDeclarations(content: string): McpDeclaration[] {
  const servers = new Map<string, McpDeclaration>();
  let currentName: string | undefined;
  let currentSubsection: string | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      const parts = parseTomlPath(section[1] ?? '');
      if (parts[0] === 'mcp_servers' && parts[1]) {
        currentName = parts[1];
        currentSubsection = parts[2];
        ensureMcpDeclaration(servers, currentName);
      } else {
        currentName = undefined;
        currentSubsection = undefined;
      }
      continue;
    }
    if (!currentName) continue;
    const assignment = line.match(/^("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const key = stripTomlQuotes(assignment[1] ?? '');
    const value = trimTomlComment(assignment[2] ?? '');
    const server = ensureMcpDeclaration(servers, currentName);
    if (currentSubsection === 'env') {
      const parsed = parseTomlString(value);
      if (parsed !== undefined) server.env[key] = parsed;
    } else if (key === '_hk_name') {
      server.name = parseTomlString(value) ?? server.name;
    } else if (key === 'command') {
      server.command = parseTomlString(value) ?? '';
    } else if (key === 'args') {
      server.args = parseTomlStringArray(value);
    } else if (key === 'env') {
      server.env = parseTomlInlineStringObject(value);
    }
  }
  return [...servers.values()];
}

function ensureMcpDeclaration(servers: Map<string, McpDeclaration>, name: string): McpDeclaration {
  const existing = servers.get(name);
  if (existing) return existing;
  const created = { name, command: '', args: [], env: {} };
  servers.set(name, created);
  return created;
}

function parseTomlPath(value: string): string[] {
  const parts: string[] = [];
  const matcher = /"((?:\\.|[^"])*)"|'([^']*)'|([A-Za-z0-9_-]+)/g;
  for (const match of value.matchAll(matcher)) {
    parts.push(unescapeTomlString(match[1] ?? match[2] ?? match[3] ?? ''));
  }
  return parts;
}

function stripTomlQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return unescapeTomlString(trimmed.slice(1, -1));
  return trimmed;
}

function trimTomlComment(value: string): string {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') quote = quote === char ? undefined : quote ?? char;
    if (char === '#' && !quote) return value.slice(0, index).trim();
  }
  return value.trim();
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return unescapeTomlString(trimmed.slice(1, -1));
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return undefined;
}

function parseTomlStringArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const output: string[] = [];
  const matcher = /"((?:\\.|[^"])*)"|'([^']*)'/g;
  for (const match of trimmed.matchAll(matcher)) output.push(unescapeTomlString(match[1] ?? match[2] ?? ''));
  return output;
}

function parseTomlInlineStringObject(value: string): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return {};
  const output: Record<string, string> = {};
  for (const part of trimmed.slice(1, -1).split(',')) {
    const assignment = part.match(/^\s*("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/);
    if (!assignment) continue;
    const parsed = parseTomlString(assignment[2] ?? '');
    if (parsed !== undefined) output[stripTomlQuotes(assignment[1] ?? '')] = parsed;
  }
  return output;
}

function unescapeTomlString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function extractJsonHookDeclarations(value: unknown): HookDeclaration[] {
  const root = asObject(value);
  const hooksRoot = asObject(root?.hooks);
  if (!hooksRoot) return [];
  const entries: HookDeclaration[] = [];
  for (const [event, rawHooks] of Object.entries(hooksRoot)) {
    for (const hook of arrayify(rawHooks)) collectHookCommands(event, undefined, hook, entries);
  }
  return dedupeHookDeclarations(entries);
}

function collectHookCommands(event: string, inheritedMatcher: string | undefined, value: unknown, output: HookDeclaration[]): void {
  if (typeof value === 'string') {
    pushHookCommand(output, event, inheritedMatcher, value);
    return;
  }
  const item = asObject(value);
  if (!item) return;
  const matcher = typeof item.matcher === 'string' && item.matcher.trim() ? item.matcher.trim() : inheritedMatcher;
  for (const key of ['command', 'bash', 'powershell', 'cmd', 'prompt']) {
    const command = item[key];
    if (typeof command === 'string') pushHookCommand(output, event, matcher, command);
  }
  for (const child of arrayify(item.hooks)) collectHookCommands(event, matcher, child, output);
}

function extractYamlHookDeclarations(content: string): HookDeclaration[] {
  const entries: HookDeclaration[] = [];
  let inHooks = false;
  let currentEvent: string | undefined;
  let currentMatcher: string | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (/^hooks:\s*$/.test(line)) {
      inHooks = true;
      currentEvent = undefined;
      currentMatcher = undefined;
      continue;
    }
    if (!inHooks) continue;
    if (/^\S[^:]*:\s*(?:$|#)/.test(line)) {
      inHooks = false;
      currentEvent = undefined;
      currentMatcher = undefined;
      continue;
    }
    const eventMatch = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
    if (eventMatch) {
      currentEvent = eventMatch[1];
      currentMatcher = undefined;
      continue;
    }
    if (!currentEvent || !/^\s{4,}/.test(line)) continue;
    const matcherMatch = line.match(/\bmatcher:\s*["']?([^"']+)["']?\s*$/);
    if (matcherMatch) currentMatcher = matcherMatch[1].trim();
    const commandMatch = line.match(/\b(?:command|bash|powershell|cmd|prompt):\s*["']?([^"']+)["']?\s*$/);
    if (currentEvent && commandMatch) pushHookCommand(entries, currentEvent, currentMatcher, commandMatch[1]);
  }
  return dedupeHookDeclarations(entries);
}

function pushHookCommand(output: HookDeclaration[], event: string, matcher: string | undefined, command: string): void {
  const normalized = command.trim();
  if (!normalized) return;
  output.push({ event, ...(matcher ? { matcher } : {}), command: normalized });
}

function dedupeHookDeclarations(entries: HookDeclaration[]): HookDeclaration[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.event}\0${entry.matcher ?? ''}\0${entry.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function arrayify(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringRecord(value: unknown): Record<string, string> {
  const object = asObject(value);
  if (!object) return {};
  return Object.fromEntries(Object.entries(object).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function versionFromMetadata(filePath: string, content: string): string | undefined {
  if (!content || !filePath.endsWith('.json')) return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'version' in parsed && typeof parsed.version === 'string') return parsed.version;
  } catch {
    return undefined;
  }
  return undefined;
}

function stablePathId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function resourceIdFor(type: LocalResourceType, sourceId: string): string {
  return `resource_${type.toLowerCase()}_${Buffer.from(sourceId).toString('base64url')}`;
}

function bindingIdFor(resourceId: string, target: string): string {
  return `binding_${Buffer.from(`${resourceId}:${target}`).toString('base64url')}`;
}

function hasUnresolvedToken(value: string): boolean {
  return /<[^>]+>/.test(value);
}

function globToRegExp(value: string): RegExp {
  let source = '^';
  for (const char of value) {
    if (char === '*') source += '[^/\\\\]+';
    else if (char === '/' || char === '\\') source += '[/\\\\]';
    else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  source += '$';
  return new RegExp(source);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  if (error instanceof Error) return error.name;
  return 'path_access_failed';
}

function isInsideOrEqual(parentPath: string, targetPath: string): boolean {
  const parent = path.resolve(parentPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(parent, target);
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}
