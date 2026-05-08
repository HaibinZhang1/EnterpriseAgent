import { randomUUID } from 'node:crypto';

export function createRequestID(prefix = 'req'): string {
  return `${prefix}_${randomUUID()}`;
}

export function ensureRequestID(requestID?: string): string {
  return requestID && requestID.trim().length > 0 ? requestID : createRequestID();
}
