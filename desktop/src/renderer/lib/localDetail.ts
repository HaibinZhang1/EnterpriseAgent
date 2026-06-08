import { asText, statusLabel } from './formatting';

export interface LocalDetailEntry {
  summary: string;
  localVersion: string;
  latestVersion: string;
  status: string;
  relatedTargets: Array<Record<string, unknown>>;
  relatedMcps: Array<Record<string, unknown>>;
  relatedPlugins: Array<Record<string, unknown>>;
}

export function formatLocalDetailDescription(entry: LocalDetailEntry): string {
  const targets = [
    ...entry.relatedTargets.map(target => asText(target.target || target.targetPath)),
    ...entry.relatedMcps.map(mcp => asText(mcp.configPath || mcp.targetConfigPath)),
    ...entry.relatedPlugins.map(plugin => asText(plugin.installPath || plugin.targetPath))
  ].filter(Boolean).slice(0, 3);
  const parts = [
    entry.summary,
    `本地状态：${statusLabel(entry.status)}`,
    entry.localVersion !== '-' ? `本地版本：${entry.localVersion}` : '',
    entry.latestVersion !== '-' && entry.latestVersion !== entry.localVersion ? `最新版本：${entry.latestVersion}` : '',
    targets.length > 0 ? `托管目标：${targets.join('；')}` : ''
  ].filter(Boolean);
  return parts.join(' · ');
}
