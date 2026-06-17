const SECRET_KEY_PATTERN = /(authorization|token|ticket|password|api[_-]?key|mcp[_-]?secret|secret|credential)/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT_PATTERN = /\b(download[_-]?ticket|ticket|api[_-]?key|password|mcp[_-]?secret|token|secret)(\s*[:=]\s*)([^\s,;}]+)/gi;
const DOWNLOAD_TICKET_PATH_PATTERN = /(download-tickets\/)[^\/\s]+/gi;

export const REDACTED = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  if (/^(requiredAuthorizations|authorizationRequirements?)$/i.test(key)) return false;
  return SECRET_KEY_PATTERN.test(key);
}

export function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(DOWNLOAD_TICKET_PATH_PATTERN, `$1${REDACTED}`)
    .replace(ASSIGNMENT_PATTERN, (_match, key, sep) => `${key}${sep}${REDACTED}`);
}

export function redactValue<T>(value: T, keyHint?: string): T | string {
  if (keyHint && isSensitiveKey(keyHint)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactValue(item, key);
    }
    return output as T;
  }
  return value;
}

export function redactForLog(value: unknown): unknown {
  return redactValue(value);
}

export function stringifyRedacted(value: unknown): string {
  return JSON.stringify(redactForLog(value));
}
