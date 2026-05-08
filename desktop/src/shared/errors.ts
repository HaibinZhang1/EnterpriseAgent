import { redactForLog } from './redaction';
import { ensureRequestID } from './request-id';

export type DesktopErrorCode =
  | 'validation_failed'
  | 'path_outside_root'
  | 'unsafe_path'
  | 'io_error'
  | 'db_error'
  | 'secure_store_unavailable'
  | 'unauthenticated'
  | 'server_unavailable'
  | 'api_error'
  | 'api_contract_stub'
  | 'scope_not_supported_in_m6'
  | 'permission_denied'
  | 'scope_restricted'
  | 'resource_not_found'
  | 'unknown_ipc_channel'
  | 'offline_server_authority_required'
  | 'offline_authorization_required'
  | 'invalid_execution_plan'
  | 'hash_mismatch'
  | 'adapter_manifest_invalid'
  | 'unknown_error';

export interface DesktopError {
  code: DesktopErrorCode;
  message: string;
  requestID: string;
  details?: unknown;
}

export class DesktopErrorException extends Error {
  readonly desktopError: DesktopError;

  constructor(error: DesktopError) {
    super(error.message);
    this.name = 'DesktopErrorException';
    this.desktopError = error;
  }
}

export function makeDesktopError(code: DesktopErrorCode, message: string, requestID?: string, details?: unknown): DesktopError {
  return {
    code,
    message,
    requestID: ensureRequestID(requestID),
    details: details === undefined ? undefined : redactForLog(details)
  };
}

export function toDesktopError(error: unknown, requestID?: string): DesktopError {
  if (error instanceof DesktopErrorException) {
    return {
      ...error.desktopError,
      requestID: ensureRequestID(requestID ?? error.desktopError.requestID)
    };
  }
  if (error instanceof Error) {
    return makeDesktopError('unknown_error', error.message, requestID);
  }
  return makeDesktopError('unknown_error', 'Unknown desktop error', requestID, error);
}

export function mapHttpStatus(status: number, requestID?: string, details?: unknown): DesktopError {
  if (status === 401) {
    return makeDesktopError('unauthenticated', 'Authentication is required', requestID, details);
  }
  if (status === 403) {
    return makeDesktopError('permission_denied', 'Permission denied', requestID, details);
  }
  if (status === 404) {
    return makeDesktopError('resource_not_found', 'Resource not found', requestID, details);
  }
  if (status >= 500) {
    return makeDesktopError('server_unavailable', 'Server is unavailable', requestID, details);
  }
  return makeDesktopError('api_error', `API request failed with status ${status}`, requestID, details);
}
