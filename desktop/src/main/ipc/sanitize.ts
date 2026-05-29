export function sanitizeLoginResult(result: unknown): unknown {
  return omitLoginSecrets(result);
}

const LOGIN_SECRET_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'resettoken',
  'tokenhash',
  'password',
  'passwordhash'
]);

function omitLoginSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => omitLoginSecrets(item));
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (LOGIN_SECRET_KEYS.has(normalizeKey(key))) continue;
    output[key] = omitLoginSecrets(item);
  }
  return output;
}

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}
