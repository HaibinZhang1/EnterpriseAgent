import { redactForLog } from '../../shared/redaction';

export function sanitizeLoginResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  const { token: _token, accessToken: _accessToken, refreshToken: _refreshToken, ...safe } = record;
  return redactForLog(safe);
}
