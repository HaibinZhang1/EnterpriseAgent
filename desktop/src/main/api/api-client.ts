import { DesktopErrorException, makeDesktopError, mapHttpStatus, type DesktopErrorCode } from '../../shared/errors';
import { ensureRequestID } from '../../shared/request-id';
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
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  login(payload: { username: string; password: string }, requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/auth/login', payload, requestID, { auth: false });
  }

  logout(requestID?: string): Promise<unknown> {
    return this.request('POST', '/api/auth/logout', undefined, requestID);
  }

  me(requestID?: string): Promise<unknown> {
    return this.request('GET', '/api/auth/me', undefined, requestID);
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

  async registerDevice(): Promise<never> {
    throw new DesktopErrorException(makeDesktopError('api_contract_stub', 'Client device server API is mocked in M6'));
  }

  async checkClientUpdate(): Promise<never> {
    throw new DesktopErrorException(makeDesktopError('api_contract_stub', 'Client update server API is mocked in M6'));
  }

  private async request<T>(method: string, path: string, body: unknown, requestID?: string, options: { auth?: boolean } = {}): Promise<T> {
    const resolvedRequestID = ensureRequestID(requestID);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = await this.buildHeaders(resolvedRequestID, options.auth !== false);
    try {
      await this.options.logger?.info('api.request', { method, path, headers }, resolvedRequestID);
      const response = await this.fetchImpl(`${this.options.baseURL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
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
      await this.options.logger?.info('api.download', { method, path, headers }, resolvedRequestID);
      const response = await this.fetchImpl(`${this.options.baseURL}${path}`, { method, headers });
      if (!response.ok) throw new DesktopErrorException(mapHttpStatus(response.status, resolvedRequestID));
      return response.arrayBuffer();
    } catch (error) {
      if (error instanceof DesktopErrorException) throw error;
      throw new DesktopErrorException(makeDesktopError('server_unavailable', 'Server is unavailable', resolvedRequestID));
    }
  }

  private async buildHeaders(requestID: string, includeAuth: boolean): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestID,
      'X-Client-Version': this.options.clientVersion
    };
    const deviceID = await this.options.getDeviceID?.();
    if (deviceID) headers['X-Device-ID'] = deviceID;
    const token = includeAuth ? await this.options.getSessionToken?.() : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }
}

function isApiEnvelope<T>(value: ApiEnvelope<T> | T | undefined): value is ApiEnvelope<T> {
  return Boolean(value && typeof value === 'object' && 'success' in value);
}

function mapServerEnvelopeError<T>(envelope: ApiEnvelope<T> | T | undefined, status: number, requestID: string) {
  if (isApiEnvelope<T>(envelope) && envelope.error?.code) {
    return makeDesktopError(toDesktopErrorCode(envelope.error.code), envelope.error.message ?? 'API request failed', envelope.requestID ?? requestID, envelope.error);
  }
  return mapHttpStatus(status, requestID, envelope);
}

function toDesktopErrorCode(code: string): DesktopErrorCode {
  if (code === 'permission_denied' || code === 'scope_restricted' || code === 'resource_not_found' || code === 'unauthenticated') {
    return code;
  }
  return 'api_error';
}
