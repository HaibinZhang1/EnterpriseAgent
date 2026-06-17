import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { AgentInventoryScanner } from '../agents/agent-inventory-scanner';
import { normalizeCustomAgentProfiles, type CustomAgentProfile } from '../agents/agent-catalog';
import type { AppPaths } from '../config/app-paths';
import type { LocalLifecycleRepository, ProjectScanTarget } from './local-lifecycle-repository';
import { LocalResourceSourceTypes, LocalResourceTypes, type LocalResourceType } from '../../shared/local-resources';

export interface LocalInventoryScanSummary {
  scannedAt: string;
  root: string;
  directories: {
    skills: string;
    plugins: string;
    mcpConfigs: string;
    adapters: string;
    projects: string;
  };
  discovered: {
    skills: number;
    plugins: number;
    mcpConfigs: number;
    tools: number;
    projects: number;
    failures: number;
    total: number;
  };
  failures: LocalInventoryScanFailure[];
}

export interface LocalInventoryScanFailure {
  path?: string;
  code: string;
  message: string;
  resourceType?: LocalResourceType;
}

interface ScannedExtensionItem {
  kind: 'skill' | 'plugin' | 'mcp';
  extensionId: string;
  name: string;
  summary?: string;
  version?: string;
  target: string;
  metadata: Record<string, unknown>;
}

interface ScannedToolItem {
  extensionId: string;
  toolName: string;
  target: string;
  metadata: Record<string, unknown>;
}

interface ScannedProjectItem {
  projectId: string;
  name: string;
  target: string;
  extensionId?: string;
  metadata: Record<string, unknown>;
}

export interface LocalInventoryScannerOptions {
  detectKnownTools?: boolean;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  customAgentProfiles?: readonly CustomAgentProfile[];
}

export class LocalInventoryScanner {
  private readonly detectKnownTools: boolean;
  private readonly homeDir: string;
  private readonly env: Record<string, string | undefined>;
  private readonly customAgentProfiles?: readonly CustomAgentProfile[];

  constructor(
    private readonly paths: AppPaths,
    private readonly lifecycleRepository: LocalLifecycleRepository,
    options: LocalInventoryScannerOptions = {}
  ) {
    this.detectKnownTools = options.detectKnownTools ?? true;
    this.homeDir = options.homeDir ?? os.homedir();
    this.env = options.env ?? process.env;
    this.customAgentProfiles = options.customAgentProfiles;
  }

  async scan(): Promise<LocalInventoryScanSummary> {
    const failures: LocalInventoryScanFailure[] = [];
    const [managedSkills, plugins, mcps, adapterTools, projects, knownToolInventory] = await Promise.all([
      scanExtensionDirectory(this.paths.centralStoreSkillsDir, 'skill', failures),
      scanExtensionDirectory(this.paths.centralStorePluginsDir, 'plugin', failures),
      scanMcpConfigs(this.paths.mcpConfigsDir, failures),
      scanTools(this.paths.adaptersDir, failures),
      scanProjects(this.paths.projectsDir, failures),
      this.detectKnownTools ? scanKnownToolInventory(this.homeDir, failures) : Promise.resolve({ skills: [], tools: [] })
    ]);
    const customProfiles = this.customAgentProfiles ?? await readConfiguredCustomAgentProfiles(this.paths.configFile, failures);
    const skills = [...managedSkills, ...knownToolInventory.skills];
    const tools = [...adapterTools, ...knownToolInventory.tools];

    for (const item of [...skills, ...plugins, ...mcps]) {
      await this.lifecycleRepository.recordScannedExtension({
        extensionId: item.extensionId,
        name: item.name,
        summary: item.summary,
        version: item.version,
        target: item.target,
        kind: item.kind,
        status: 'scanned',
        metadata: item.metadata
      });
      if (item.kind === 'mcp') {
        await this.lifecycleRepository.recordMcpInstallation({
          extensionId: item.extensionId,
          target: item.target,
          status: 'scanned',
          configPath: item.target,
          metadata: item.metadata
        });
      } else if (item.kind === 'plugin') {
        await this.lifecycleRepository.recordPluginInstallation({
          extensionId: item.extensionId,
          target: item.target,
          status: 'scanned',
          adapterId: stringValue(item.metadata.adapterId),
          metadata: item.metadata
        });
      }
    }

    for (const item of tools) {
      await this.lifecycleRepository.recordScannedTool({
        extensionId: item.extensionId,
        target: item.target,
        toolName: item.toolName,
        status: 'scanned',
        metadata: item.metadata
      });
    }

    for (const item of projects) {
      await this.lifecycleRepository.recordScannedProject({
        projectId: item.projectId,
        name: item.name,
        extensionId: item.extensionId,
        status: 'scanned',
        metadata: { ...item.metadata, target: item.target }
      });
    }

    const platform = process.platform === 'win32' ? 'windows' : 'macos';
    const agentSummaries = [await new AgentInventoryScanner(this.lifecycleRepository, {
      platform,
      homeDir: this.homeDir,
      userProfileDir: this.homeDir,
      env: this.env,
      includeMissingPaths: true,
      customProfiles
    }).scan()];
    const projectScanTargets = mergeProjectScanTargets([
      ...this.lifecycleRepository.listProjectScanTargets(),
      ...projects.map((item) => ({
        projectId: item.projectId,
        name: item.name,
        targetPath: item.target,
        metadata: item.metadata
      }))
    ]);
    for (const projectTarget of projectScanTargets) {
      agentSummaries.push(await new AgentInventoryScanner(this.lifecycleRepository, {
        platform,
        homeDir: this.homeDir,
        userProfileDir: this.homeDir,
        projectRoot: projectTarget.targetPath,
        projectId: projectTarget.projectId,
        env: this.env,
        includeMissingPaths: false,
        customProfiles
      }).scan());
    }

    for (const failure of failures) {
      await this.lifecycleRepository.recordScanFailure({
        ...failure,
        sourceType: failure.code.startsWith('agent_profiles_') ? LocalResourceSourceTypes.CUSTOM_DIRECTORY : LocalResourceSourceTypes.LOCAL_IMPORT,
        metadata: { scanSource: 'local_inventory_scan' }
      });
    }

    const agentFailures = agentSummaries.reduce((total, item) => total + item.failures, 0);
    const agentResources = agentSummaries.reduce((total, item) => total + item.resources, 0);
    const discovered = {
      skills: skills.length,
      plugins: plugins.length,
      mcpConfigs: mcps.length,
      tools: tools.length,
      projects: projectScanTargets.length,
      failures: failures.length + agentFailures,
      total: skills.length + plugins.length + mcps.length + tools.length + projectScanTargets.length + agentResources
    };
    return {
      scannedAt: new Date().toISOString(),
      root: this.paths.root,
      directories: {
        skills: this.paths.centralStoreSkillsDir,
        plugins: this.paths.centralStorePluginsDir,
        mcpConfigs: this.paths.mcpConfigsDir,
        adapters: this.paths.adaptersDir,
        projects: this.paths.projectsDir
      },
      discovered,
      failures
    };
  }
}

function mergeProjectScanTargets(targets: ProjectScanTarget[]): ProjectScanTarget[] {
  const seen = new Set<string>();
  const merged: ProjectScanTarget[] = [];
  for (const target of targets) {
    const key = `${target.projectId}:${path.resolve(target.targetPath)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...target, targetPath: path.resolve(target.targetPath) });
  }
  return merged;
}

async function readConfiguredCustomAgentProfiles(configFile: string, failures: LocalInventoryScanFailure[]): Promise<CustomAgentProfile[]> {
  try {
    const raw = await readFile(configFile, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const validation = normalizeCustomAgentProfiles(parsed.agentProfiles);
    if (!validation.valid) {
      failures.push({
        path: configFile,
        code: 'agent_profiles_invalid',
        message: validation.errors.join('; '),
        resourceType: LocalResourceTypes.AGENT_CONFIG
      });
      return [];
    }
    return validation.normalized;
  } catch (error) {
    if (isMissingFileError(error)) return [];
    failures.push({
      path: configFile,
      code: error instanceof SyntaxError ? 'agent_profiles_parse_failed' : 'agent_profiles_read_failed',
      message: error instanceof Error ? error.message : 'Unable to read configured Agent Profiles',
      resourceType: LocalResourceTypes.AGENT_CONFIG
    });
    return [];
  }
}

async function scanExtensionDirectory(directory: string, kind: 'skill' | 'plugin', failures: LocalInventoryScanFailure[]): Promise<ScannedExtensionItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedExtensionItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() && !isPackageFile(entry.name)) continue;
    const target = path.join(directory, entry.name);
    let manifest: Record<string, unknown>;
    try {
      manifest = await readManifest(target, entry.isDirectory());
    } catch (error) {
      failures.push(scanFailure(error, target, kind === 'skill' ? LocalResourceTypes.SKILL : LocalResourceTypes.PLUGIN));
      continue;
    }
    const fallbackName = path.basename(entry.name, path.extname(entry.name));
    const extensionId = stringValue(manifest.extensionId ?? manifest.extensionID ?? manifest.id ?? manifest.name) ?? `${kind}:${fallbackName}`;
    items.push({
      kind,
      extensionId,
      name: stringValue(manifest.displayName ?? manifest.title ?? manifest.name) ?? fallbackName,
      summary: stringValue(manifest.summary ?? manifest.description),
      version: stringValue(manifest.version ?? manifest.currentVersion),
      target,
      metadata: {
        source: 'local_inventory_scan',
        packageName: entry.name,
        adapterId: manifest.adapterId,
        manifestKind: manifest.type ?? manifest.kind
      }
    });
  }
  return items;
}

async function scanMcpConfigs(directory: string, failures: LocalInventoryScanFailure[]): Promise<ScannedExtensionItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedExtensionItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isFile() || !isConfigFile(entry.name)) continue;
    const target = path.join(directory, entry.name);
    let manifest: Record<string, unknown>;
    try {
      manifest = entry.name.endsWith('.json') ? await readJsonFile(target) : {};
    } catch (error) {
      failures.push(scanFailure(error, target, LocalResourceTypes.MCP_SERVER));
      continue;
    }
    const fallbackName = path.basename(entry.name, path.extname(entry.name));
    const serverNames = isRecord(manifest.mcpServers) ? Object.keys(manifest.mcpServers) : [];
    const extensionId = stringValue(manifest.extensionId ?? manifest.extensionID ?? manifest.id) ?? `mcp:${serverNames[0] ?? fallbackName}`;
    items.push({
      kind: 'mcp',
      extensionId,
      name: stringValue(manifest.displayName ?? manifest.title ?? manifest.name) ?? serverNames[0] ?? fallbackName,
      summary: stringValue(manifest.summary ?? manifest.description),
      version: stringValue(manifest.version),
      target,
      metadata: {
        source: 'local_inventory_scan',
        configFile: entry.name,
        mcpServerNames: serverNames
      }
    });
  }
  return items;
}

async function scanTools(directory: string, failures: LocalInventoryScanFailure[]): Promise<ScannedToolItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedToolItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() && !isPackageFile(entry.name)) continue;
    const target = path.join(directory, entry.name);
    let manifest: Record<string, unknown>;
    try {
      manifest = await readManifest(target, entry.isDirectory());
    } catch (error) {
      failures.push(scanFailure(error, target, LocalResourceTypes.KIT));
      continue;
    }
    const fallbackName = path.basename(entry.name, path.extname(entry.name));
    const toolName = stringValue(manifest.toolName ?? manifest.name ?? manifest.id) ?? fallbackName;
    items.push({
      extensionId: stringValue(manifest.extensionId ?? manifest.extensionID) ?? `tool:${toolName}`,
      toolName,
      target,
      metadata: {
        source: 'local_inventory_scan',
        packageName: entry.name,
        adapterId: manifest.adapterId,
        version: manifest.version
      }
    });
  }
  return items;
}

async function scanProjects(directory: string, failures: LocalInventoryScanFailure[]): Promise<ScannedProjectItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedProjectItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    let manifest: Record<string, unknown>;
    try {
      manifest = await readManifest(target, true);
    } catch (error) {
      failures.push(scanFailure(error, target, LocalResourceTypes.PROJECT));
      continue;
    }
    items.push({
      projectId: stringValue(manifest.projectId ?? manifest.id) ?? `project:${entry.name}`,
      name: stringValue(manifest.displayName ?? manifest.name) ?? entry.name,
      extensionId: stringValue(manifest.extensionId ?? manifest.extensionID),
      target,
      metadata: {
        source: 'local_inventory_scan',
        directoryName: entry.name,
        version: manifest.version
      }
    });
  }
  return items;
}

async function scanKnownToolInventory(homeDir: string, failures: LocalInventoryScanFailure[]): Promise<{ skills: ScannedExtensionItem[]; tools: ScannedToolItem[] }> {
  const codexRoot = path.join(homeDir, '.codex');
  const hasCodex = await directoryExists(codexRoot);
  if (!hasCodex) return { skills: [], tools: [] };

  const skillRoots = [
    path.join(codexRoot, 'skills'),
    path.join(codexRoot, 'skills', '.system')
  ];
  const skills = (await Promise.all(skillRoots.map((root) => scanCodexSkills(root, failures)))).flat();
  return {
    skills,
    tools: [{
      extensionId: 'tool.codex',
      toolName: 'Codex',
      target: codexRoot,
      metadata: {
        source: 'known_tool_scan',
        adapterId: 'codex',
        skillsDir: path.join(codexRoot, 'skills'),
        pluginsDir: path.join(codexRoot, 'plugins')
      }
    }]
  };
}

async function scanCodexSkills(directory: string, failures: LocalInventoryScanFailure[]): Promise<ScannedExtensionItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedExtensionItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name === '.system') continue;
    const skillDirectory = path.join(directory, entry.name);
    const skillFile = path.join(skillDirectory, 'SKILL.md');
    let skillMarkdown: string | undefined;
    try {
      skillMarkdown = await readTextFile(skillFile);
    } catch (error) {
      failures.push(scanFailure(error, skillFile, LocalResourceTypes.SKILL));
      continue;
    }
    if (!skillMarkdown) continue;
    const manifest = parseSkillFrontmatter(skillMarkdown);
    const title = manifest.name ?? firstHeading(skillMarkdown) ?? '未命名 Skill';
    items.push({
      kind: 'skill',
      extensionId: `codex:skills:${stablePathId(skillFile)}`,
      name: title,
      summary: manifest.description ?? firstParagraph(skillMarkdown),
      target: skillFile,
      metadata: {
        source: 'known_tool_scan',
        adapterId: 'codex',
        managed: false,
        directoryName: entry.name,
        skillDirectory,
        hasSkillMd: true,
        hash: sha256(skillMarkdown),
        skillFile
      }
    });
  }
  return items;
}

async function safeReadDir(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return Array.isArray(entries);
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function readManifest(target: string, isDirectory: boolean): Promise<Record<string, unknown>> {
  if (!isDirectory) return await readJsonFile(target);
  for (const fileName of ['agenthub.json', 'manifest.json', 'package.json', 'skill.json', 'plugin.json', 'project.json']) {
    const value = await readJsonFile(path.join(target, fileName));
    if (Object.keys(value).length > 0) return value;
  }
  return {};
}

async function readTextFile(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isMissingFileError(error)) return {};
    throw error;
  }
}

function scanFailure(error: unknown, target: string, resourceType: LocalResourceType): LocalInventoryScanFailure {
  if (error instanceof SyntaxError) {
    return {
      path: target,
      code: 'manifest_parse_failed',
      message: `无法解析本地资源配置：${error.message}`,
      resourceType
    };
  }
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'scan_read_failed';
  const message = error instanceof Error ? error.message : '本地资源读取失败';
  return { path: target, code, message, resourceType };
}

function isPackageFile(name: string): boolean {
  return ['.json'].includes(path.extname(name).toLowerCase());
}

function isConfigFile(name: string): boolean {
  return ['.json', '.yaml', '.yml', '.toml'].includes(path.extname(name).toLowerCase());
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseSkillFrontmatter(markdown: string): { name?: string; description?: string } {
  if (!markdown.startsWith('---')) return {};
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const metadata: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parsed = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!parsed) continue;
    const key = parsed[1].toLowerCase();
    const value = unquoteYamlScalar(parsed[2].trim());
    if (!value) continue;
    if (key === 'name') metadata.name = value;
    if (key === 'description') metadata.description = value;
  }
  return metadata;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function firstHeading(markdown: string): string | undefined {
  const line = stripFrontmatter(markdown).split(/\r?\n/).find((value) => /^#\s+/.test(value));
  return line?.replace(/^#\s+/, '').trim();
}

function firstParagraph(markdown: string): string | undefined {
  const paragraph = stripFrontmatter(markdown)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  if (!paragraph) return undefined;
  return paragraph.length > 160 ? `${paragraph.slice(0, 157)}...` : paragraph;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stablePathId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
