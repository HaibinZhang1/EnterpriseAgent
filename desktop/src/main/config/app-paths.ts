import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

export const APP_DIR_NAME = 'EnterpriseAgentHub';

export interface AppPaths {
  root: string;
  configFile: string;
  deviceFile: string;
  localDbFile: string;
  centralStoreDir: string;
  centralStoreSkillsDir: string;
  centralStorePluginsDir: string;
  mcpDir: string;
  mcpConfigsDir: string;
  mcpVariablesDir: string;
  adaptersDir: string;
  projectsDir: string;
  tempDir: string;
  backupsDir: string;
  eventsDir: string;
  cacheDir: string;
  logsDir: string;
}

export interface AppRootProvider {
  getPath(name: 'appData'): string;
}

export interface ResolveAppRootOptions {
  app?: AppRootProvider;
  rootOverride?: string;
}

export function resolveDefaultAppRoot(options: ResolveAppRootOptions = {}): string {
  if (options.rootOverride) return path.resolve(options.rootOverride);
  if (options.app) return path.join(options.app.getPath('appData'), APP_DIR_NAME);
  if (process.env.APPDATA) return path.join(process.env.APPDATA, APP_DIR_NAME);
  return path.join(os.homedir(), '.enterprise-agent-hub');
}

export function buildAppPaths(root: string): AppPaths {
  const resolvedRoot = path.resolve(root);
  return {
    root: resolvedRoot,
    configFile: path.join(resolvedRoot, 'config.json'),
    deviceFile: path.join(resolvedRoot, 'device.json'),
    localDbFile: path.join(resolvedRoot, 'local.db'),
    centralStoreDir: path.join(resolvedRoot, 'central-store'),
    centralStoreSkillsDir: path.join(resolvedRoot, 'central-store', 'skills'),
    centralStorePluginsDir: path.join(resolvedRoot, 'central-store', 'plugins'),
    mcpDir: path.join(resolvedRoot, 'mcp'),
    mcpConfigsDir: path.join(resolvedRoot, 'mcp', 'configs'),
    mcpVariablesDir: path.join(resolvedRoot, 'mcp', 'variables'),
    adaptersDir: path.join(resolvedRoot, 'adapters'),
    projectsDir: path.join(resolvedRoot, 'projects'),
    tempDir: path.join(resolvedRoot, 'temp'),
    backupsDir: path.join(resolvedRoot, 'backups'),
    eventsDir: path.join(resolvedRoot, 'events'),
    cacheDir: path.join(resolvedRoot, 'cache'),
    logsDir: path.join(resolvedRoot, 'logs')
  };
}

export const REQUIRED_APP_DIRECTORIES: Array<keyof Pick<AppPaths,
  | 'centralStoreDir'
  | 'centralStoreSkillsDir'
  | 'centralStorePluginsDir'
  | 'mcpDir'
  | 'mcpConfigsDir'
  | 'mcpVariablesDir'
  | 'adaptersDir'
  | 'projectsDir'
  | 'tempDir'
  | 'backupsDir'
  | 'eventsDir'
  | 'cacheDir'
  | 'logsDir'
>> = [
  'centralStoreDir',
  'centralStoreSkillsDir',
  'centralStorePluginsDir',
  'mcpDir',
  'mcpConfigsDir',
  'mcpVariablesDir',
  'adaptersDir',
  'projectsDir',
  'tempDir',
  'backupsDir',
  'eventsDir',
  'cacheDir',
  'logsDir'
];

async function ensureJsonFile(file: string, value: unknown): Promise<void> {
  try {
    await readFile(file, 'utf8');
  } catch {
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

export async function initializeAppDataLayout(root: string): Promise<AppPaths> {
  const paths = buildAppPaths(root);
  try {
    await mkdir(paths.root, { recursive: true });
    for (const key of REQUIRED_APP_DIRECTORIES) {
      await mkdir(paths[key], { recursive: true });
    }
    await ensureJsonFile(paths.configFile, { baseURL: 'http://localhost:8080', theme: 'system', notificationsEnabled: true });
    return paths;
  } catch (error) {
    throw new DesktopErrorException(makeDesktopError('io_error', 'Failed to initialize desktop app-data layout', undefined, error));
  }
}

export function resolveInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new DesktopErrorException(makeDesktopError('path_outside_root', 'Path escapes the approved app-data root', undefined, { candidate }));
  }
  return resolved;
}
