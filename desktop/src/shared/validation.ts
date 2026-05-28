import { DesktopErrorException, makeDesktopError } from './errors';

export type RecordPayload = Record<string, unknown>;

export function assertRecord(value: unknown, requestID?: string): RecordPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DesktopErrorException(makeDesktopError('validation_failed', 'Payload must be an object', requestID));
  }
  return value as RecordPayload;
}

export function optionalString(payload: RecordPayload, key: string, requestID?: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} must be a string`, requestID));
  }
  return value;
}

export function requiredString(payload: RecordPayload, key: string, requestID?: string): string {
  const value = optionalString(payload, key, requestID);
  if (!value) {
    throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} is required`, requestID));
  }
  return value;
}

export function optionalBoolean(payload: RecordPayload, key: string, requestID?: string): boolean | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} must be a boolean`, requestID));
  }
  return value;
}

export function optionalRecord(payload: RecordPayload, key: string, requestID?: string): RecordPayload | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  return assertRecord(value, requestID);
}

export function requiredRecord(payload: RecordPayload, key: string, requestID?: string): RecordPayload {
  const value = optionalRecord(payload, key, requestID);
  if (!value) {
    throw new DesktopErrorException(makeDesktopError('validation_failed', `${key} is required`, requestID));
  }
  return value;
}
