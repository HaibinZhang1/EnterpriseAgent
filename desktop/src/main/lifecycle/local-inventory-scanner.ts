import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { AppPaths } from '../config/app-paths';
import type { LocalLifecycleRepository } from './local-lifecycle-repository';

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
    total: number;
  };
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
}

export class LocalInventoryScanner {
  private readonly detectKnownTools: boolean;
  private readonly homeDir: string;

  constructor(
    private readonly paths: AppPaths,
    private readonly lifecycleRepository: LocalLifecycleRepository,
    options: LocalInventoryScannerOptions = {}
  ) {
    this.detectKnownTools = options.detectKnownTools ?? true;
    this.homeDir = options.homeDir ?? os.homedir();
  }

  async scan(): Promise<LocalInventoryScanSummary> {
    const [managedSkills, plugins, mcps, adapterTools, projects, knownToolInventory] = await Promise.all([
      scanExtensionDirectory(this.paths.centralStoreSkillsDir, 'skill'),
      scanExtensionDirectory(this.paths.centralStorePluginsDir, 'plugin'),
      scanMcpConfigs(this.paths.mcpConfigsDir),
      scanTools(this.paths.adaptersDir),
      scanProjects(this.paths.projectsDir),
      this.detectKnownTools ? scanKnownToolInventory(this.homeDir) : Promise.resolve({ skills: [], tools: [] })
    ]);
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

    const discovered = {
      skills: skills.length,
      plugins: plugins.length,
      mcpConfigs: mcps.length,
      tools: tools.length,
      projects: projects.length,
      total: skills.length + plugins.length + mcps.length + tools.length + projects.length
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
      discovered
    };
  }
}

async function scanExtensionDirectory(directory: string, kind: 'skill' | 'plugin'): Promise<ScannedExtensionItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedExtensionItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() && !isPackageFile(entry.name)) continue;
    const target = path.join(directory, entry.name);
    const manifest = await readManifest(target, entry.isDirectory());
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

async function scanMcpConfigs(directory: string): Promise<ScannedExtensionItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedExtensionItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isFile() || !isConfigFile(entry.name)) continue;
    const target = path.join(directory, entry.name);
    const manifest = entry.name.endsWith('.json') ? await readJsonFile(target) : {};
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

async function scanTools(directory: string): Promise<ScannedToolItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedToolItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() && !isPackageFile(entry.name)) continue;
    const target = path.join(directory, entry.name);
    const manifest = await readManifest(target, entry.isDirectory());
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

async function scanProjects(directory: string): Promise<ScannedProjectItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedProjectItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    const manifest = await readManifest(target, true);
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

async function scanKnownToolInventory(homeDir: string): Promise<{ skills: ScannedExtensionItem[]; tools: ScannedToolItem[] }> {
  const codexRoot = path.join(homeDir, '.codex');
  const hasCodex = await directoryExists(codexRoot);
  if (!hasCodex) return { skills: [], tools: [] };

  const skillRoots = [
    path.join(codexRoot, 'skills'),
    path.join(codexRoot, 'skills', '.system')
  ];
  const skills = (await Promise.all(skillRoots.map((root) => scanCodexSkills(root)))).flat();
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

async function scanCodexSkills(directory: string): Promise<ScannedExtensionItem[]> {
  const entries = await safeReadDir(directory);
  const items: ScannedExtensionItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name === '.system') continue;
    const target = path.join(directory, entry.name);
    const skillFile = path.join(target, 'SKILL.md');
    const skillMarkdown = await readTextFile(skillFile);
    if (!skillMarkdown) continue;
    const skillId = `codex.skill.${entry.name}`;
    const title = firstHeading(skillMarkdown) ?? entry.name;
    items.push({
      kind: 'skill',
      extensionId: skillId,
      name: title,
      summary: firstParagraph(skillMarkdown),
      target,
      metadata: {
        source: 'known_tool_scan',
        adapterId: 'codex',
        managed: false,
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
    if (isMissingFileError(error) || error instanceof SyntaxError) return {};
    throw error;
  }
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

function firstHeading(markdown: string): string | undefined {
  const line = markdown.split(/\r?\n/).find((value) => /^#\s+/.test(value));
  return line?.replace(/^#\s+/, '').trim();
}

function firstParagraph(markdown: string): string | undefined {
  const paragraph = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('---'));
  if (!paragraph) return undefined;
  return paragraph.length > 160 ? `${paragraph.slice(0, 157)}...` : paragraph;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
