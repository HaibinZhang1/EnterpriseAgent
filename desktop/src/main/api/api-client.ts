import { DesktopErrorException, makeDesktopError, mapHttpStatus, type DesktopErrorCode } from '../../shared/errors';
import { ensureRequestID } from '../../shared/request-id';
import type { DeviceInfo } from '../config/device-id-store';
import type { LocalEventRecord } from '../events/local-event-queue';
import { mapServerLocalEventStatus, type LocalEventSyncTransportResult, type ServerLocalEventSyncResponse } from '../events/local-event-sync-service';
import type { ClientLogger } from '../logging/client-logger';

export interface ApiClientOptions {
  baseURL: string;
  getSessionToken?: () => Promise<string | undefined>;
  getDeviceID?: () => Promise<string | undefined>;
  clientVersion: string;
  fetchImpl?: typeof fetch;
  logger?: ClientLogger;
  timeoutMs?: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
  requestID?: string;
  requestId?: string;
}

export interface LoginPayload {
  phone: string;
  password: string;
  clientType?: 'DESKTOP' | 'ADMIN_WEB';
  deviceId?: string;
  clientVersion?: string;
}

export interface DeviceRegistrationPayload {
  deviceId: string;
  clientVersion: string;
  osVersion: string;
  arch: string;
  hostnameHash?: string;
}

export interface DeviceEventPayload {
  idempotencyKey?: string;
  eventType: string;
  result?: string;
  errorCode?: string;
  requestID?: string;
  fromVersion?: string;
  toVersion?: string;
  payloadSummary?: Record<string, unknown>;
}

export interface ClientUpdateCheckPayload {
  deviceId: string;
  currentVersion: string;
  platform: string;
  arch: string;
  channel?: string;
}

export interface ClientUpdateSignatureMetadata {
  status?: string;
  publisher?: string;
  certificateThumbprint?: string;
  signature?: string;
}

export interface ClientUpdateInfo {
  updateAvailable: boolean;
  versionId?: string;
  version?: string;
  build?: string;
  force?: boolean;
  minSupportedVersion?: string;
  packageSha256?: string;
  packageSize?: number;
  signature?: ClientUpdateSignatureMetadata;
  releaseNotes?: string;
}

export interface ClientUpdateDownloadTicket {
  ticket: string;
  expiresAt?: string;
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  login(payload: LoginPayload, requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/auth/login', payload, requestID, { auth: false });
  }

  logout(requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/auth/logout', undefined, requestID);
  }

  health(requestID?: string): Promise<unknown> {
    return this.request('GET', '/api/health', undefined, requestID, { auth: false });
  }

  me(requestID?: string): Promise<unknown> {
    return this.request('GET', '/api/auth/me', undefined, requestID);
  }

  changePassword(payload: { oldPassword: string; newPassword: string }, requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/auth/change-password', payload, requestID);
  }

  completeResetPassword(payload: { resetToken: string; newPassword: string }, requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/auth/reset-password/complete', payload, requestID, { auth: false });
  }

  communityHome(requestID?: string): Promise<unknown> {
    return this.request('GET', '/api/extensions/community/home', undefined, requestID);
  }

  searchExtensions(query: string, requestID?: string): Promise<unknown> {
    return this.request('GET', `/api/extensions/search?q=${encodeURIComponent(query)}`, undefined, requestID);
  }

  extensionDetail(extensionID: string, requestID?: string): Promise<unknown> {
    return this.request('GET', `/api/extensions/${encodeURIComponent(extensionID)}`, undefined, requestID);
  }

  extensionVersions(extensionID: string, requestID?: string): Promise<unknown> {
    return this.request('GET', `/api/extensions/${encodeURIComponent(extensionID)}/versions`, undefined, requestID);
  }

  setStar(extensionID: string, starred: boolean, requestID?: string): Promise<unknown> {
    if (!starred) {
      return this.request('DELETE', `/api/extensions/${encodeURIComponent(extensionID)}/star`, undefined, requestID);
    }
    return this.request('POST', `/api/extensions/${encodeURIComponent(extensionID)}/star`, { starred }, requestID);
  }

  uploadPackage(payload: { uploadType: string; fileName: string; mimeType?: string; contentBase64: string }, requestID?: string): Promise<unknown> {
    const form = new FormData();
    form.set('uploadType', payload.uploadType);
    const bytes = Buffer.from(payload.contentBase64, 'base64');
    form.set('file', new Blob([bytes], { type: payload.mimeType || 'application/octet-stream' }), payload.fileName);
    return this.request('POST', '/api/uploads/package', form, requestID, { rawBody: true });
  }

  createSubmission(payload: unknown, requestID?: string, idempotencyKey?: string): Promise<unknown> {
    return this.request('POST', '/api/submissions', payload, requestID, { extraHeaders: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined });
  }

  listMySubmissions(requestID?: string): Promise<unknown> {
    return this.request('GET', '/api/submissions/mine', undefined, requestID);
  }

  getSubmission(submissionID: string, requestID?: string): Promise<unknown> {
    return this.request('GET', `/api/submissions/${encodeURIComponent(submissionID)}`, undefined, requestID);
  }

  withdrawSubmission(submissionID: string, requestID?: string, idempotencyKey?: string): Promise<unknown> {
    return this.request('POST', `/api/submissions/${encodeURIComponent(submissionID)}/withdraw`, undefined, requestID, { extraHeaders: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined });
  }

  resubmitSubmission(submissionID: string, payload: unknown, requestID?: string, idempotencyKey?: string): Promise<unknown> {
    return this.request('POST', `/api/submissions/${encodeURIComponent(submissionID)}/resubmit`, payload, requestID, { extraHeaders: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined });
  }

  createDownloadTicket(payload: { extensionID: string; version: string }, requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/download-tickets', payload, requestID);
  }

  downloadPackage(ticket: string, requestID?: string): Promise<ArrayBuffer> {
    return this.requestBinary('GET', `/api/download-tickets/${encodeURIComponent(ticket)}/download`, requestID);
  }

  getMcpDefinition(extensionID: string, requestID?: string): Promise<unknown> {
    return this.request('GET', `/api/extensions/${encodeURIComponent(extensionID)}/mcp-definition`, undefined, requestID);
  }

  getPluginDefinition(extensionID: string, requestID?: string): Promise<unknown> {
    return this.request('GET', `/api/extensions/${encodeURIComponent(extensionID)}/plugin-definition`, undefined, requestID);
  }

  async syncLocalEvents(events: LocalEventRecord[], requestID?: string): Promise<LocalEventSyncTransportResult> {
    const deviceID = events[0]?.deviceID ?? await this.options.getDeviceID?.();
    const response = await this.request<ServerLocalEventSyncResponse>('POST', '/api/local-events/sync', {
      deviceId: deviceID,
      events: events.map((event) => ({
        idempotencyKey: event.idempotencyKey,
        extensionId: event.extensionID,
        version: event.version,
        type: event.eventType,
        result: event.result,
        errorCode: event.errorCode,
        payloadSummary: event.payload
      }))
    }, requestID);
    return {
      acknowledgements: response.results.map((result) => ({
        idempotencyKey: result.idempotencyKey,
        result: mapServerLocalEventStatus(result.status),
        errorCode: result.errorCode
      })),
      serverStateHints: response.serverStateHints ?? []
    };
  }

  async registerDevice(device: DeviceInfo | DeviceRegistrationPayload, requestID?: string): Promise<unknown> {
    const payload = toDeviceRegistrationPayload(device, this.options.clientVersion);
    return this.request('POST', '/api/client-devices/register', payload, requestID);
  }

  heartbeat(payload: { deviceId: string; clientVersion: string; localEventQueueSize?: number }, requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/client-devices/heartbeat', payload, requestID);
  }

  reportDeviceEvents(deviceId: string, events: DeviceEventPayload[], requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/client-devices/events', { deviceId, events }, requestID);
  }

  async checkClientUpdate(payload: ClientUpdateCheckPayload, requestID?: string): Promise<ClientUpdateInfo> {
    const response = await this.request<Record<string, unknown>>('GET', `/api/client-updates/check?deviceId=${encodeURIComponent(payload.deviceId)}&currentVersion=${encodeURIComponent(payload.currentVersion)}&platform=${encodeURIComponent(payload.platform)}&arch=${encodeURIComponent(payload.arch)}${payload.channel ? `&channel=${encodeURIComponent(payload.channel)}` : ''}`, undefined, requestID);
    return normalizeClientUpdateInfo(response);
  }

  createClientUpdateDownloadTicket(payload: { deviceId: string; versionId: string; currentVersion?: string }, requestID?: string): Promise<ClientUpdateDownloadTicket> {
    return this.request('POST', `/api/client-updates/${encodeURIComponent(payload.versionId)}/download-ticket`, {
      deviceId: payload.deviceId,
      currentVersion: payload.currentVersion
    }, requestID);
  }

  downloadClientUpdate(ticket: string, requestID?: string): Promise<ArrayBuffer> {
    return this.requestBinary('GET', `/api/download-tickets/${encodeURIComponent(ticket)}/download`, requestID);
  }

  reportClientUpdateEvents(deviceId: string, events: DeviceEventPayload[], requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/client-updates/events', { deviceId, events }, requestID);
  }

  listNotifications(requestID?: string): Promise<unknown> {
    return this.request('GET', '/api/notifications', undefined, requestID);
  }

  markNotificationRead(notificationID: string, requestID?: string): Promise<unknown> {
    return this.request('POST', `/api/notifications/${encodeURIComponent(notificationID)}/read`, undefined, requestID);
  }

  private async request<T>(method: string, path: string, body: unknown, requestID?: string, options: { auth?: boolean; rawBody?: boolean; extraHeaders?: Record<string, string> } = {}): Promise<T> {
    const resolvedRequestID = ensureRequestID(requestID);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      ...await this.buildHeaders(resolvedRequestID, options.auth !== false, options.rawBody ? undefined : 'application/json'),
      ...(options.extraHeaders ?? {})
    };
    try {
      await this.options.logger?.info('api.request', { method, path, headers: redactHeaders(headers) }, resolvedRequestID);
      const response = await this.fetchImpl(`${this.options.baseURL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : options.rawBody ? body as BodyInit : JSON.stringify(body),
        signal: controller.signal
      });
      const envelope = await response.json().catch(() => undefined) as ApiEnvelope<T> | T | undefined;
      if (!response.ok) {
        throw new DesktopErrorException(mapServerEnvelopeError(envelope, response.status, resolvedRequestID));
      }
      if (isApiEnvelope<T>(envelope)) {
        if (!envelope.success) {
          throw new DesktopErrorException(mapServerEnvelopeError(envelope, response.status, resolvedRequestID));
        }
        return envelope.data as T;
      }
      return envelope as T;
    } catch (error) {
      if (error instanceof DesktopErrorException) throw error;
      const message = error instanceof Error && error.name === 'AbortError' ? 'API request timed out' : 'Server is unavailable';
      throw new DesktopErrorException(makeDesktopError('server_unavailable', message, resolvedRequestID));
    } finally {
      clearTimeout(timeout);
    }
  }


  private async requestBinary(method: string, path: string, requestID?: string): Promise<ArrayBuffer> {
    const resolvedRequestID = ensureRequestID(requestID);
    const headers = await this.buildHeaders(resolvedRequestID, true);
    try {
      await this.options.logger?.info('api.download', { method, path, headers: redactHeaders(headers) }, resolvedRequestID);
      const response = await this.fetchImpl(`${this.options.baseURL}${path}`, { method, headers });
      if (!response.ok) throw new DesktopErrorException(mapHttpStatus(response.status, resolvedRequestID));
      return response.arrayBuffer();
    } catch (error) {
      if (error instanceof DesktopErrorException) throw error;
      throw new DesktopErrorException(makeDesktopError('server_unavailable', 'Server is unavailable', resolvedRequestID));
    }
  }

  private async buildHeaders(requestID: string, includeAuth: boolean, contentType: string | undefined = 'application/json'): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'X-Request-ID': requestID,
      'X-Client-Version': this.options.clientVersion
    };
    if (contentType) headers['Content-Type'] = contentType;
    const deviceID = await this.options.getDeviceID?.();
    if (deviceID) headers['X-Device-ID'] = deviceID;
    const token = includeAuth ? await this.options.getSessionToken?.() : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }
}

function toDeviceRegistrationPayload(device: DeviceInfo | DeviceRegistrationPayload, fallbackClientVersion: string): DeviceRegistrationPayload {
  if ('deviceId' in device) return device;
  return {
    deviceId: device.deviceID,
    clientVersion: device.clientVersion ?? fallbackClientVersion,
    osVersion: process.platform,
    arch: process.arch
  };
}

function normalizeClientUpdateInfo(response: Record<string, unknown>): ClientUpdateInfo {
  const build = response.buildNo ?? response.build;
  const packageSha256 = response.packageSha256 ?? response.sha256;
  return {
    updateAvailable: Boolean(response.updateAvailable),
    versionId: response.versionId === undefined ? undefined : String(response.versionId),
    version: response.version === undefined ? undefined : String(response.version),
    build: build === undefined ? undefined : String(build),
    force: response.forceUpdate === undefined ? Boolean(response.force) : Boolean(response.forceUpdate),
    minSupportedVersion: response.minSupportedVersion === undefined ? undefined : String(response.minSupportedVersion),
    packageSha256: packageSha256 === undefined ? undefined : String(packageSha256),
    packageSize: typeof response.packageSize === 'number' ? response.packageSize : undefined,
    signature: {
      status: response.signatureStatus === undefined ? undefined : String(response.signatureStatus)
    },
    releaseNotes: response.releaseNotes === undefined ? undefined : String(response.releaseNotes)
  };
}

function isApiEnvelope<T>(value: ApiEnvelope<T> | T | undefined): value is ApiEnvelope<T> {
  return Boolean(value && typeof value === 'object' && 'success' in value);
}

function mapServerEnvelopeError<T>(envelope: ApiEnvelope<T> | T | undefined, status: number, requestID: string) {
  if (isApiEnvelope<T>(envelope) && envelope.error?.code) {
    return makeDesktopError(toDesktopErrorCode(envelope.error.code), envelope.error.message ?? 'API request failed', envelope.requestID ?? envelope.requestId ?? requestID, envelope.error);
  }
  return mapHttpStatus(status, requestID, envelope);
}

function toDesktopErrorCode(code: string): DesktopErrorCode {
  if (code === 'permission_denied' || code === 'scope_restricted' || code === 'resource_not_found' || code === 'unauthenticated') {
    return code;
  }
  return 'api_error';
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  if (redacted.Authorization) redacted.Authorization = '[redacted]';
  return redacted;
}
