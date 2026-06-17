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

  async scan(): Promise<AgentInventoryScanSummary> {
    const scannedAt = new Date().toISOString();
    let resources = 0;
    let missingPaths = 0;
    let failures = 0;
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
            metadata: { agentId: manifest.agentId, kind: candidate.kind, pattern: candidate.fromPattern }
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
      metadata: { kind: candidate.kind, pattern: candidate.fromPattern, projectId: projectScope.projectId }
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
      metadata: { kind: candidate.kind, pattern: candidate.fromPattern, projectId: projectScope.projectId }
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
          name: path.basename(filePath) || `${displayName} ${kindLabels[candidate.kind]}`,
          path: filePath,
          content,
          agentId,
          projectId: projectScope.projectId,
          permissionSummary,
          metadata: {
            kind: candidate.kind,
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
        name: path.basename(filePath) || `${displayName} ${kindLabels[candidate.kind]}`,
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
        metadata: { kind: candidate.kind, pattern: candidate.fromPattern, projectId: projectScope.projectId }
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
  return { candidates, failures };
}

async function expandPattern(pattern: string): Promise<{ paths: string[]; error?: unknown }> {
  if (!pattern.includes('*')) return { paths: [pattern] };
  const firstStar = pattern.indexOf('*');
  const base = path.resolve(pattern.slice(0, firstStar).replace(/[\\/][^\\/]*$/, ''));
  const regex = globToRegExp(path.resolve(pattern));
  try {
    const files = await walkFiles(base, 3);
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
    if (entry.isDirectory()) files.push(...await walkFiles(filePath, depth - 1));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

async function listDirectoryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => path.join(directory, entry.name));
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
  switch (kind) {
    case 'settings': return LocalResourceTypes.AGENT_CONFIG;
    case 'rules': return LocalResourceTypes.RULE;
    case 'memory': return LocalResourceTypes.MEMORY;
    case 'subagents': return LocalResourceTypes.SUBAGENT;
    case 'ignore-files': return LocalResourceTypes.IGNORE_FILE;
    case 'skills': return LocalResourceTypes.SKILL;
    case 'mcp': return LocalResourceTypes.MCP_SERVER;
    case 'plugins': return LocalResourceTypes.PLUGIN;
    case 'hooks': return LocalResourceTypes.HOOK;
    case 'cli': return LocalResourceTypes.CLI_COMMAND;
    case 'files': return LocalResourceTypes.AGENT_CONFIG;
    default: return LocalResourceTypes.AGENT_CONFIG;
  }
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
