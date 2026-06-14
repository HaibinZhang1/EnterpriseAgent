export type Role = "NORMAL_USER" | "DEPARTMENT_ADMIN" | "SYSTEM_ADMIN";

export interface UserSummary {
  id: string;
  name: string;
  phoneMasked: string;
  role: Role;
  departmentId?: string;
  departmentName?: string;
  status: string;
  mustChangePassword: boolean;
  updatedAt?: string;
}

export interface PermissionSummary {
  canUseDesktop: boolean;
  canUseAdminWeb: boolean;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: UserSummary;
  permissionSummary: PermissionSummary;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

export type ApiRecord = Record<string, unknown>;

interface ApiEnvelope<T> {
  requestId?: string;
  success: boolean;
  data: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    retryable?: boolean;
  } | null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
}

export class AdminApiError extends Error {
  code?: string;
  requestId?: string;
  details?: unknown;

  constructor(message: string, options: { code?: string; requestId?: string; details?: unknown } = {}) {
    super(message);
    this.name = "AdminApiError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

const tokenKey = "eah.admin.token";
const userKey = "eah.admin.user";
const baseUrlKey = "eah.admin.apiBaseUrl";

type BrowserStorageKind = "local" | "session";

function browserStorage(kind: BrowserStorageKind = "local"): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function sessionStorages(): Storage[] {
  return [browserStorage("local"), browserStorage("session")].filter((storage): storage is Storage => Boolean(storage));
}

export function getStoredToken(): string | null {
  for (const storage of sessionStorages()) {
    const token = storage.getItem(tokenKey);
    if (token) return token;
  }
  return null;
}

export function getStoredUser(): UserSummary | null {
  for (const storage of sessionStorages()) {
    const raw = storage.getItem(userKey);
    if (!raw) continue;
    try {
      return JSON.parse(raw) as UserSummary;
    } catch {
      continue;
    }
  }
  return null;
}

export function storeSession(response: LoginResponse, keepSignedIn = true): void {
  const storage = browserStorage(keepSignedIn ? "local" : "session");
  const fallbackStorage = browserStorage(keepSignedIn ? "session" : "local");
  if (!storage) {
    return;
  }
  fallbackStorage?.removeItem(tokenKey);
  fallbackStorage?.removeItem(userKey);
  storage.setItem(tokenKey, response.token);
  storage.setItem(userKey, JSON.stringify(response.user));
}

export function clearSession(): void {
  for (const storage of sessionStorages()) {
    storage.removeItem(tokenKey);
    storage.removeItem(userKey);
  }
}

export function getApiBaseUrl(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const storedBase = browserStorage()?.getItem(baseUrlKey) ?? "";
  return normalizeBaseUrl(storedBase || envBase || "http://localhost:8080");
}

export function setApiBaseUrl(value: string): string {
  const normalized = normalizeBaseUrl(value);
  browserStorage()?.setItem(baseUrlKey, normalized);
  return normalized;
}

export function adminExportUrl(path: string, query: Record<string, unknown> = {}): string {
  const url = new URL(`/api${path}`, getApiBaseUrl());
  applyQuery(url, query);
  return url.toString();
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api${path}`, getApiBaseUrl());
  applyQuery(url, options.query ?? {});
  const headers = new Headers({ "X-Request-ID": requestId() });
  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  const response = await fetch(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const contentType = response.headers.get("content-type") ?? "";
  const envelope = contentType.includes("application/json")
    ? ((await response.json()) as ApiEnvelope<T>)
    : null;
  if (!response.ok) {
    throw new AdminApiError(envelope?.error?.message ?? `请求失败：HTTP ${response.status}`, {
      code: envelope?.error?.code,
      requestId: envelope?.requestId,
      details: envelope?.error?.details
    });
  }
  if (!envelope) {
    throw new AdminApiError("服务端返回格式无法识别");
  }
  if (!envelope.success) {
    throw new AdminApiError(envelope.error?.message ?? "请求失败", {
      code: envelope.error?.code,
      requestId: envelope.requestId,
      details: envelope.error?.details
    });
  }
  return envelope.data;
}

export async function requestText(path: string, options: RequestOptions = {}): Promise<string> {
  const url = new URL(`/api${path}`, getApiBaseUrl());
  applyQuery(url, options.query ?? {});
  const headers = new Headers({ "X-Request-ID": requestId() });
  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers
  });
  if (!response.ok) {
    const text = await response.text();
    throw new AdminApiError(text || `请求失败：HTTP ${response.status}`);
  }
  return response.text();
}

export const adminApi = {
  auth: {
    async login(phone: string, password: string): Promise<LoginResponse> {
      return request<LoginResponse>("/auth/login", {
        method: "POST",
        body: { phone, password, clientType: "ADMIN_WEB" }
      });
    },
    async me(): Promise<UserSummary> {
      return request<UserSummary>("/auth/me");
    },
    async logout(): Promise<void> {
      await request<void>("/auth/logout", { method: "POST", body: {} });
    },
    async changePassword(oldPassword: string, newPassword: string): Promise<void> {
      await request<void>("/auth/change-password", {
        method: "POST",
        body: { oldPassword, newPassword }
      });
    }
  },
  notifications: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/notifications", { query }),
    read: (notificationId: string) => request<ApiRecord>(`/notifications/${notificationId}/read`, { method: "POST", body: {} })
  },
  reviews: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/reviews/tasks", { query }),
    detail: (submissionId: string) => request<ApiRecord>(`/reviews/tasks/${submissionId}`),
    decision: (submissionId: string, action: "approve" | "request-changes" | "reject", body: ApiRecord) =>
      request<ApiRecord>(`/reviews/tasks/${submissionId}/${action}`, {
        method: "POST",
        body,
        idempotencyKey: requestId()
      })
  },
  extensions: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/admin/extensions", { query }),
    detail: (extensionId: string) => request<ApiRecord>(`/admin/extensions/${extensionId}`),
    versions: (extensionId: string) => request<unknown>(`/admin/extensions/${extensionId}/versions`),
    govern: (extensionId: string, action: string, body: ApiRecord = {}) =>
      request<ApiRecord>(`/admin/extensions/${extensionId}/${action}`, {
        method: "POST",
        body,
        idempotencyKey: requestId()
      })
  },
  departments: {
    tree: (query: Record<string, unknown> = {}) => request<ApiRecord[]>("/admin/departments/tree", { query }),
    create: (body: ApiRecord) => request<ApiRecord>("/admin/departments", {
      method: "POST",
      body,
      idempotencyKey: requestId()
    }),
    action: (departmentId: string, action: "enable" | "disable" | "delete", body: ApiRecord) =>
      request<ApiRecord | null>(`/admin/departments/${departmentId}${action === "delete" ? "" : `/${action}`}`, {
        method: action === "delete" ? "DELETE" : "POST",
        body,
        idempotencyKey: requestId()
      })
  },
  users: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/admin/users", { query }),
    create: (body: ApiRecord) => request<ApiRecord>("/admin/users", {
      method: "POST",
      body,
      idempotencyKey: requestId()
    }),
    detail: (userId: string) => request<ApiRecord>(`/admin/users/${userId}`),
    action: (userId: string, action: "freeze" | "unfreeze" | "delete", body: ApiRecord) =>
      request<ApiRecord | null>(`/admin/users/${userId}${action === "delete" ? "" : `/${action}`}`, {
        method: action === "delete" ? "DELETE" : "POST",
        body,
        idempotencyKey: requestId()
      }),
    resetPassword: (userId: string, body: ApiRecord) =>
      request<ApiRecord>(`/admin/users/${userId}/reset-password`, {
        method: "POST",
        body,
        idempotencyKey: requestId()
      })
  },
  audit: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/admin/audit-logs", { query }),
    exportCsv: (query: Record<string, unknown> = {}) => requestText("/admin/audit-logs/export", { query })
  },
  devices: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/admin/client-devices", { query }),
    versionDistribution: (query: Record<string, unknown> = {}) =>
      request<ApiRecord[]>("/admin/client-devices/version-distribution", { query }),
    detail: (deviceId: string) => request<ApiRecord>(`/admin/client-devices/${deviceId}`)
  },
  updates: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/admin/client-updates", { query }),
    create: (body: ApiRecord) => request<ApiRecord>("/admin/client-updates", { method: "POST", body }),
    transition: (versionId: string, action: "publish" | "pause" | "withdraw", body: ApiRecord) =>
      request<ApiRecord>(`/admin/client-updates/${versionId}/${action}`, { method: "POST", body }),
    events: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/admin/client-updates/events", { query })
  },
  settings: {
    list: (query: Record<string, unknown> = {}) => request<PageResult<ApiRecord>>("/admin/settings", { query }),
    detail: (key: string) => request<ApiRecord>(`/admin/settings/${encodeURIComponent(key)}`),
    update: (key: string, body: ApiRecord) =>
      request<ApiRecord>(`/admin/settings/${encodeURIComponent(key)}`, { method: "PATCH", body })
  }
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || "http://localhost:8080";
}

function applyQuery(url: URL, query: Record<string, unknown>): void {
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });
}

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
