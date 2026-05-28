import type { ExtensionKind } from '../types/desktop';

export function extensionKindLabel(kind: ExtensionKind | string | undefined): string {
  if (kind === 'skill') return 'Skill';
  if (kind === 'mcp') return 'MCP';
  if (kind === 'plugin') return 'Plugin';
  return '扩展';
}

export function statusLabel(status: string | undefined): string {
  const normalized = (status ?? '').toLowerCase();
  if (normalized === 'installed') return '已安装';
  if (normalized === 'scanned') return '已扫描';
  if (normalized === 'enabled') return '已启用';
  if (normalized === 'connected') return '已接入';
  if (normalized === 'delisted') return '已下架';
  if (normalized === 'scope_reduced') return '授权收缩';
  if (normalized === 'security_blocked') return '安全风险';
  if (normalized === 'partial_success') return '部分成功';
  if (normalized === 'failed') return '失败';
  if (normalized === 'pending' || normalized === 'queued') return '待同步';
  return status || '未知';
}

export function riskTone(value: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | undefined {
  const normalized = (value ?? '').toLowerCase();
  if (['high', 'critical', 'security_blocked', 'security_risk'].includes(normalized)) return 'danger';
  if (['medium', 'scope_reduced', 'delisted', 'partial_success'].includes(normalized)) return 'warn';
  if (['low', 'installed', 'enabled', 'connected', 'success'].includes(normalized)) return 'ok';
  if (['scanned', 'server_hint_info', 'metadata_refresh'].includes(normalized)) return 'info';
  return undefined;
}

export function compactDate(value: string | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function asText(value: unknown, fallback = '-'): string {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}
