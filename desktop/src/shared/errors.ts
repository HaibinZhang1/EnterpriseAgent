import { redactForLog } from './redaction';
import { ensureRequestID } from './request-id';

export type DesktopErrorCode =
  | 'validation_failed'
  | 'path_outside_root'
  | 'unsafe_path'
  | 'io_error'
  | 'db_error'
  | 'secure_store_unavailable'
  | 'secure_store_corrupted'
  | 'unauthenticated'
  | 'server_unavailable'
  | 'api_error'
  | 'permission_denied'
  | 'scope_restricted'
  | 'resource_not_found'
  | 'state_conflict'
  | 'package_too_large'
  | 'package_file_count_exceeded'
  | 'package_path_traversal'
  | 'package_uncompressed_size_exceeded'
  | 'package_unsafe_file_detected'
  | 'skill_manifest_missing'
  | 'mcp_config_template_invalid'
  | 'mcp_transport_invalid'
  | 'mcp_endpoint_invalid'
  | 'plugin_manifest_invalid'
  | 'upload_expired'
  | 'upload_not_owned'
  | 'upload_already_consumed'
  | 'download_ticket_required'
  | 'download_ticket_expired'
  | 'download_ticket_used'
  | 'download_purpose_invalid'
  | 'download_ticket_purpose_invalid'
  | 'download_failed'
  | 'local_hash_mismatch'
  | 'target_path_not_writable'
  | 'target_path_not_found'
  | 'tool_not_detected'
  | 'symlink_failed'
  | 'backup_failed'
  | 'rollback_failed'
  | 'signature_invalid'
  | 'signature_verify_failed'
  | 'plugin_tool_version_incompatible'
  | 'plugin_download_source_expired'
  | 'plugin_download_source_failed'
  | 'local_store_not_writable'
  | 'temp_store_not_writable'
  | 'unknown_ipc_channel'
  | 'offline_server_authority_required'
  | 'offline_authorization_required'
  | 'invalid_execution_plan'
  | 'hash_mismatch'
  | 'signature_verification_failed'
  | 'installer_launch_failed'
  | 'update_confirmation_required'
  | 'adapter_manifest_invalid'
  | 'unknown_error';

export interface DesktopError {
  code: DesktopErrorCode;
  message: string;
  requestID: string;
  retryable: boolean;
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
    retryable: retryableByDefault(code),
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

export function withRetryable(error: DesktopError, retryable: boolean): DesktopError {
  return { ...error, retryable };
}

function retryableByDefault(code: DesktopErrorCode): boolean {
  return ['server_unavailable', 'download_failed', 'plugin_download_source_failed', 'temp_store_not_writable'].includes(code);
}
