import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  AdminApiError,
  ApiRecord,
  PageResult,
  Role,
  UserSummary,
  adminApi,
  clearSession,
  getApiBaseUrl,
  getStoredToken,
  getStoredUser,
  setApiBaseUrl,
  storeSession
} from "./api";
import "./styles.css";

type PageKey = "overview" | "reviews" | "extensions" | "organization" | "audit" | "devices" | "updates" | "settings";

interface SessionState {
  token: string;
  user: UserSummary;
}

interface ViewError {
  message: string;
  code?: string;
  requestId?: string;
}

type Resource<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ViewError };

const emptyPage: PageResult<ApiRecord> = { items: [], page: 1, pageSize: 20, total: 0, hasNext: false };

const pageDefinitions: Array<{ key: PageKey; label: string; systemOnly?: boolean }> = [
  { key: "overview", label: "概览" },
  { key: "reviews", label: "审核" },
  { key: "extensions", label: "扩展管理" },
  { key: "organization", label: "部门与用户" },
  { key: "audit", label: "审计日志" },
  { key: "devices", label: "客户端设备" },
  { key: "updates", label: "客户端更新", systemOnly: true },
  { key: "settings", label: "系统设置", systemOnly: true }
];

export default function App() {
  const [session, setSession] = useState<SessionState | null>(() => {
    const token = getStoredToken();
    const user = getStoredUser();
    return token && user ? { token, user } : null;
  });
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [shellError, setShellError] = useState<ViewError | null>(null);

  useEffect(() => {
    if (!session?.token) {
      return;
    }
    adminApi.auth.me()
      .then((user) => setSession({ token: session.token, user }))
      .catch((error) => {
        const normalized = normalizeError(error);
        if (normalized.code === "UNAUTHORIZED" || normalized.code === "SESSION_EXPIRED") {
          clearSession();
          setSession(null);
        } else {
          setShellError(normalized);
        }
      });
  }, [session?.token]);

  const visiblePages = useMemo(
    () => pageDefinitions.filter((item) => !item.systemOnly || session?.user.role === "SYSTEM_ADMIN"),
    [session?.user.role]
  );

  useEffect(() => {
    if (!visiblePages.some((item) => item.key === activePage)) {
      setActivePage("overview");
    }
  }, [activePage, visiblePages]);

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">EA</div>
          <div>
            <h1>Enterprise Agent Hub</h1>
            <p>Web Admin</p>
          </div>
        </div>
        <nav className="side-nav" aria-label="管理端导航">
          {visiblePages.map((item) => (
            <button
              key={item.key}
              type="button"
              className={activePage === item.key ? "active" : ""}
              onClick={() => setActivePage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main-area">
        <header className="top-bar">
          <div>
            <span className="eyebrow">{roleLabel(session.user.role)}</span>
            <h2>{pageDefinitions.find((item) => item.key === activePage)?.label}</h2>
          </div>
          <div className="top-actions">
            <span className="api-pill">{getApiBaseUrl()}</span>
            <button type="button" className="icon-button" onClick={() => setNotificationsOpen(true)}>
              通知
            </button>
            <button type="button" className="ghost-button" onClick={() => setPasswordOpen(true)}>
              改密
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                adminApi.auth.logout().catch(() => undefined);
                clearSession();
                setSession(null);
              }}
            >
              退出
            </button>
          </div>
        </header>
        {shellError ? <ErrorBanner error={shellError} onClose={() => setShellError(null)} /> : null}
        <PageRouter page={activePage} user={session.user} setPage={setActivePage} />
      </main>
      {notificationsOpen ? <NotificationsDrawer onClose={() => setNotificationsOpen(false)} /> : null}
      {passwordOpen ? (
        <ChangePasswordModal
          onClose={() => setPasswordOpen(false)}
          onChanged={() => {
            setPasswordOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function PageRouter({ page, user, setPage }: { page: PageKey; user: UserSummary; setPage: (page: PageKey) => void }) {
  if ((page === "updates" || page === "settings") && user.role !== "SYSTEM_ADMIN") {
    return <PermissionState title="无权访问" message="客户端更新和系统设置仅系统管理员可见。" />;
  }
  switch (page) {
    case "overview":
      return <OverviewPage user={user} setPage={setPage} />;
    case "reviews":
      return <ReviewsPage />;
    case "extensions":
      return <ExtensionsPage />;
    case "organization":
      return <OrganizationPage />;
    case "audit":
      return <AuditPage setPage={setPage} />;
    case "devices":
      return <DevicesPage />;
    case "updates":
      return <ClientUpdatesPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <OverviewPage user={user} setPage={setPage} />;
  }
}

export function LoginScreen({ onLogin }: { onLogin: (session: SessionState) => void }) {
  const [apiBase, setApiBase] = useState(getApiBaseUrl());
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ViewError | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setApiBaseUrl(apiBase);
      const response = await adminApi.auth.login(phone, password);
      if (!response.permissionSummary.canUseAdminWeb || !isAdminRole(response.user.role)) {
        clearSession();
        setError({ message: "当前账号没有进入 Web 管理端的权限。" });
        return;
      }
      storeSession(response);
      onLogin({ token: response.token, user: response.user });
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-block login-brand">
          <div className="brand-mark">EA</div>
          <div>
            <h1>Enterprise Agent Hub</h1>
            <p>管理端登录</p>
          </div>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label>
            服务端地址
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
          </label>
          <label>
            手机号
            <input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="username" />
          </label>
          <label>
            密码
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error ? <InlineError error={error} /> : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "登录中" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function OverviewPage({ user, setPage }: { user: UserSummary; setPage: (page: PageKey) => void }) {
  const resource = useResource(async () => {
    const [reviews, audit, devices, riskyExtensions, updateEvents] = await Promise.all([
      adminApi.reviews.list({ status: "PENDING", pageSize: 5 }),
      adminApi.audit.list({ pageSize: 5 }),
      adminApi.devices.list({ pageSize: 5 }),
      adminApi.extensions.list({ status: "SECURITY_DELISTED", pageSize: 5 }),
      user.role === "SYSTEM_ADMIN" ? adminApi.updates.events({ result: "FAILURE", pageSize: 5 }) : Promise.resolve(emptyPage)
    ]);
    return { reviews, audit, devices, riskyExtensions, updateEvents };
  }, [user.role]);

  return (
    <ResourceState resource={resource}>
      {(data) => (
        <div className="page-grid">
          <div className="metric-grid">
            <Metric label="待审核申请" value={data.reviews.total} onClick={() => setPage("reviews")} />
            <Metric label="安全下架扩展" value={data.riskyExtensions.total} tone="warning" onClick={() => setPage("extensions")} />
            <Metric label="客户端设备" value={data.devices.total} tone="success" onClick={() => setPage("devices")} />
            <Metric label="更新失败事件" value={data.updateEvents.total} tone="danger" onClick={() => setPage("updates")} />
          </div>
          <Panel title="最近审核">
            <RecordList
              items={data.reviews.items}
              empty="暂无待处理审核"
              primary={(item) => safeString(read(item, "extensionName", "name", "title", "submissionId"))}
              secondary={(item) => safeString(read(item, "status", "extensionType", "type"))}
            />
          </Panel>
          <Panel title="最近审计">
            <RecordList
              items={data.audit.items}
              empty="暂无审计日志"
              primary={(item) => safeString(read(item, "action"))}
              secondary={(item) => `${safeString(read(item, "result"))} · ${formatDate(read(item, "createdAt"))}`}
            />
          </Panel>
        </div>
      )}
    </ResourceState>
  );
}

function ReviewsPage() {
  const [status, setStatus] = useState("PENDING");
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const resource = useResource(
    () => adminApi.reviews.list({ status, pageSize: 20 }),
    [status, refreshKey]
  );

  return (
    <div className="split-page">
      <Panel title="审核列表" actions={<Select value={status} onChange={setStatus} options={["PENDING", "APPROVED", "CHANGES_REQUESTED", "REJECTED"]} />}>
        <ResourceState resource={resource}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState title="暂无审核任务" />
            ) : (
              <DataTable
                items={page.items}
                columns={[
                  { label: "扩展", render: (row) => safeString(read(row, "extensionName", "name", "extensionId")) },
                  { label: "类型", render: (row) => safeString(read(row, "extensionType", "type")) },
                  { label: "状态", render: (row) => <Badge value={safeString(read(row, "status"))} /> },
                  { label: "提交时间", render: (row) => formatDate(read(row, "submittedAt", "createdAt")) }
                ]}
                onSelect={setSelected}
              />
            )
          }
        </ResourceState>
      </Panel>
      <ReviewDetailPanel selected={selected} onChanged={() => setRefreshKey((value) => value + 1)} />
    </div>
  );
}

function ReviewDetailPanel({ selected, onChanged }: { selected: ApiRecord | null; onChanged: () => void }) {
  const submissionId = selected ? safeString(read(selected, "submissionId", "id")) : "";
  const resource = useResource(
    () => (submissionId ? adminApi.reviews.detail(submissionId) : Promise.resolve(null)),
    [submissionId]
  );
  const [comment, setComment] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<ViewError | null>(null);

  async function decide(action: "approve" | "request-changes" | "reject", detail: ApiRecord) {
    setBusyAction(action);
    setError(null);
    try {
      const revisionId = safeString(read(detail, "revisionId", "currentRevisionId", "revision.id"));
      await adminApi.reviews.decision(submissionId, action, {
        revisionId: revisionId || undefined,
        comment,
        reasonCodes: comment ? ["MANUAL_REVIEW"] : []
      });
      setComment("");
      onChanged();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusyAction(null);
    }
  }

  if (!selected) {
    return <Panel title="审核详情"><EmptyState title="选择一条审核任务" /></Panel>;
  }

  return (
    <Panel title="审核详情">
      <ResourceState resource={resource}>
        {(detail) => {
          if (!detail) {
            return <EmptyState title="选择一条审核任务" />;
          }
          return (
            <div className="detail-stack">
              <KeyValue record={detail} keys={["submissionId", "extensionId", "extensionName", "extensionType", "status", "submittedAt"]} />
              <JsonPreview value={read(detail, "aiPrecheck", "precheck", "latestRevision")} />
              <label>
                审核意见
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
              </label>
              {error ? <InlineError error={error} /> : null}
              <div className="button-row">
                <button className="primary-button" type="button" disabled={!!busyAction} onClick={() => decide("approve", detail)}>
                  {busyAction === "approve" ? "处理中" : "通过"}
                </button>
                <button className="secondary-button" type="button" disabled={!!busyAction} onClick={() => decide("request-changes", detail)}>
                  要求修改
                </button>
                <button className="danger-button" type="button" disabled={!!busyAction} onClick={() => decide("reject", detail)}>
                  驳回
                </button>
              </div>
            </div>
          );
        }}
      </ResourceState>
    </Panel>
  );
}

function ExtensionsPage() {
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const resource = useResource(
    () => adminApi.extensions.list({ keyword, type, status, pageSize: 20 }),
    [keyword, type, status, refreshKey]
  );

  return (
    <div className="split-page">
      <Panel
        title="扩展管理"
        actions={
          <div className="filter-row">
            <input className="compact-input" placeholder="搜索" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <Select value={type} onChange={setType} options={["", "SKILL", "MCP_SERVER", "PLUGIN"]} />
            <Select value={status} onChange={setStatus} options={["", "PUBLISHED", "DELISTED", "SECURITY_DELISTED", "ARCHIVED"]} />
          </div>
        }
      >
        <ResourceState resource={resource}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState title="暂无扩展" />
            ) : (
              <DataTable
                items={page.items}
                columns={[
                  { label: "名称", render: (row) => safeString(read(row, "name", "extensionName", "extensionId")) },
                  { label: "类型", render: (row) => safeString(read(row, "type", "extensionType")) },
                  { label: "可见性", render: (row) => safeString(read(row, "visibilityMode")) },
                  { label: "状态", render: (row) => <Badge value={safeString(read(row, "status"))} /> }
                ]}
                onSelect={setSelected}
              />
            )
          }
        </ResourceState>
      </Panel>
      <ExtensionDetailPanel selected={selected} onChanged={() => setRefreshKey((value) => value + 1)} />
    </div>
  );
}

function ExtensionDetailPanel({ selected, onChanged }: { selected: ApiRecord | null; onChanged: () => void }) {
  const extensionId = selected ? safeString(read(selected, "extensionId", "id")) : "";
  const detailResource = useResource(
    () => (extensionId ? adminApi.extensions.detail(extensionId) : Promise.resolve(null)),
    [extensionId]
  );
  const versionsResource = useResource(
    () => (extensionId ? adminApi.extensions.versions(extensionId) : Promise.resolve(null)),
    [extensionId]
  );
  const [reason, setReason] = useState("");
  const [targetVisibilityMode, setTargetVisibilityMode] = useState("AUTHORIZED_ONLY");
  const [targetScope, setTargetScope] = useState("{\n  \"scopeType\": \"DEPARTMENT\",\n  \"departmentIds\": []\n}");
  const [error, setError] = useState<ViewError | null>(null);
  const [success, setSuccess] = useState("");

  async function govern(action: string) {
    if (!extensionId) {
      return;
    }
    setError(null);
    setSuccess("");
    try {
      await adminApi.extensions.govern(extensionId, action, {
        reason,
        reasonType: action,
        reasonDetail: reason,
        securityReason: action === "security-delist" ? reason : undefined,
        targetVisibilityMode: action === "visibility/reduce" ? targetVisibilityMode : undefined,
        targetScope: action === "scope/reduce" ? JSON.parse(targetScope) : undefined
      });
      setSuccess("治理动作已提交");
      onChanged();
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  if (!selected) {
    return <Panel title="扩展详情"><EmptyState title="选择一个扩展" /></Panel>;
  }

  return (
    <Panel title="扩展详情">
      <ResourceState resource={detailResource}>
        {(detail) => {
          if (!detail) {
            return <EmptyState title="选择一个扩展" />;
          }
          return (
            <div className="detail-stack">
              <KeyValue record={detail} keys={["extensionId", "id", "name", "type", "status", "visibilityMode", "ownerDepartmentName"]} />
              <JsonPreview value={read(detail, "scope", "definition", "manifest")} />
              <ResourceState resource={versionsResource} compact>
                {(versions) => <JsonPreview title="版本记录" value={versions} />}
              </ResourceState>
              <label>
                原因
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <label>
                目标可见性
                <select value={targetVisibilityMode} onChange={(event) => setTargetVisibilityMode(event.target.value)}>
                  <option value="AUTHORIZED_ONLY">AUTHORIZED_ONLY</option>
                  <option value="PUBLIC_TO_ALL_LOGGED_IN">PUBLIC_TO_ALL_LOGGED_IN</option>
                </select>
              </label>
              <label>
                目标授权范围 JSON
                <textarea value={targetScope} onChange={(event) => setTargetScope(event.target.value)} />
              </label>
              {error ? <InlineError error={error} /> : null}
              {success ? <p className="success-text">{success}</p> : null}
              <div className="button-row wrap">
                <button type="button" className="secondary-button" onClick={() => govern("delist")}>下架</button>
                <button type="button" className="danger-button" onClick={() => govern("security-delist")}>安全下架</button>
                <button type="button" className="secondary-button" onClick={() => govern("relist")}>恢复上架</button>
                <button type="button" className="secondary-button" onClick={() => govern("scope/reduce")}>收缩授权</button>
                <button type="button" className="secondary-button" onClick={() => govern("visibility/reduce")}>收缩可见性</button>
                <button type="button" className="ghost-button" onClick={() => govern("archive")}>归档</button>
              </div>
            </div>
          );
        }}
      </ResourceState>
    </Panel>
  );
}

function OrganizationPage() {
  const [tab, setTab] = useState<"departments" | "users">("departments");
  return (
    <div className="page-grid">
      <div className="segmented">
        <button type="button" className={tab === "departments" ? "active" : ""} onClick={() => setTab("departments")}>组织结构</button>
        <button type="button" className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>用户账号</button>
      </div>
      {tab === "departments" ? <DepartmentsPanel /> : <UsersPanel />}
    </div>
  );
}

function DepartmentsPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [form, setForm] = useState({ parentId: "", name: "", reason: "" });
  const [error, setError] = useState<ViewError | null>(null);
  const resource = useResource(() => adminApi.departments.tree({ includeDisabled: true }), [refreshKey]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await adminApi.departments.create({
        parentId: form.parentId || undefined,
        name: form.name,
        reason: form.reason
      });
      setForm({ parentId: "", name: "", reason: "" });
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  async function departmentAction(departmentId: string, action: "enable" | "disable") {
    try {
      await adminApi.departments.action(departmentId, action, { reason: form.reason || action });
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <div className="split-page">
      <Panel title="部门树">
        <ResourceState resource={resource}>
          {(departments) => departments.length === 0 ? <EmptyState title="暂无部门" /> : <TreeList items={departments} onAction={departmentAction} />}
        </ResourceState>
      </Panel>
      <Panel title="新建部门">
        <form className="form-stack" onSubmit={create}>
          <input placeholder="父部门 ID，可为空" value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })} />
          <input placeholder="部门名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <textarea placeholder="原因" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          {error ? <InlineError error={error} /> : null}
          <button className="primary-button" type="submit">创建部门</button>
        </form>
      </Panel>
    </div>
  );
}

function UsersPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    departmentId: "",
    role: "NORMAL_USER",
    initialPassword: "",
    mustChangePassword: true,
    reason: ""
  });
  const [error, setError] = useState<ViewError | null>(null);
  const [resetToken, setResetToken] = useState("");
  const resource = useResource(() => adminApi.users.list({ keyword, pageSize: 20 }), [keyword, refreshKey]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await adminApi.users.create(form);
      setForm({ name: "", phone: "", departmentId: "", role: "NORMAL_USER", initialPassword: "", mustChangePassword: true, reason: "" });
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  async function userAction(userId: string, action: "freeze" | "unfreeze" | "delete" | "reset") {
    setError(null);
    setResetToken("");
    try {
      if (action === "reset") {
        const response = await adminApi.users.resetPassword(userId, { mustChangePassword: true, reason: form.reason || "reset" });
        setResetToken(safeString(read(response, "resetToken")));
      } else {
        await adminApi.users.action(userId, action, { reason: form.reason || action });
      }
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <div className="split-page">
      <Panel
        title="用户账号"
        actions={<input className="compact-input" placeholder="搜索用户" value={keyword} onChange={(event) => setKeyword(event.target.value)} />}
      >
        <ResourceState resource={resource}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState title="暂无用户" />
            ) : (
              <DataTable
                items={page.items}
                columns={[
                  { label: "姓名", render: (row) => safeString(read(row, "name")) },
                  { label: "手机号", render: (row) => safeString(read(row, "phoneMasked")) },
                  { label: "部门", render: (row) => safeString(read(row, "departmentName")) },
                  { label: "角色", render: (row) => roleLabel(safeString(read(row, "role")) as Role) },
                  { label: "状态", render: (row) => <Badge value={safeString(read(row, "status"))} /> },
                  {
                    label: "操作",
                    render: (row) => {
                      const userId = safeString(read(row, "id"));
                      return (
                        <div className="inline-actions">
                          <button type="button" onClick={() => userAction(userId, "freeze")}>冻结</button>
                          <button type="button" onClick={() => userAction(userId, "unfreeze")}>解冻</button>
                          <button type="button" onClick={() => userAction(userId, "reset")}>重置</button>
                        </div>
                      );
                    }
                  }
                ]}
              />
            )
          }
        </ResourceState>
      </Panel>
      <Panel title="新建用户">
        <form className="form-stack" onSubmit={create}>
          <input placeholder="姓名" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input placeholder="手机号" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          <input placeholder="部门 ID" value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })} />
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            <option value="NORMAL_USER">普通用户</option>
            <option value="DEPARTMENT_ADMIN">部门管理员</option>
            <option value="SYSTEM_ADMIN">系统管理员</option>
          </select>
          <input placeholder="初始密码" type="password" value={form.initialPassword} onChange={(event) => setForm({ ...form, initialPassword: event.target.value })} />
          <label className="check-row">
            <input type="checkbox" checked={form.mustChangePassword} onChange={(event) => setForm({ ...form, mustChangePassword: event.target.checked })} />
            首次登录强制改密
          </label>
          <textarea placeholder="原因" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          {resetToken ? <p className="success-text">重置令牌：{resetToken}</p> : null}
          {error ? <InlineError error={error} /> : null}
          <button className="primary-button" type="submit">创建用户</button>
        </form>
      </Panel>
    </div>
  );
}

function AuditPage({ setPage }: { setPage: (page: PageKey) => void }) {
  const [query, setQuery] = useState({ action: "", result: "", objectType: "" });
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<ViewError | null>(null);
  const resource = useResource(
    () => adminApi.audit.list({ ...query, pageSize: 20 }),
    [query.action, query.result, query.objectType, refreshKey]
  );

  async function exportCsv() {
    setError(null);
    try {
      setCsv(await adminApi.audit.exportCsv(query));
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <div className="split-page">
      <Panel
        title="审计日志"
        actions={
          <div className="filter-row">
            <input className="compact-input" placeholder="动作" value={query.action} onChange={(event) => setQuery({ ...query, action: event.target.value })} />
            <input className="compact-input" placeholder="对象类型" value={query.objectType} onChange={(event) => setQuery({ ...query, objectType: event.target.value })} />
            <Select value={query.result} onChange={(result) => setQuery({ ...query, result })} options={["", "SUCCESS", "FAILURE"]} />
            <button type="button" className="secondary-button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>
            <button type="button" className="secondary-button" onClick={exportCsv}>导出</button>
          </div>
        }
      >
        {error ? <InlineError error={error} /> : null}
        {csv ? <JsonPreview title="CSV 预览" value={csv.split("\n").slice(0, 5).join("\n")} /> : null}
        <ResourceState resource={resource}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState title="暂无审计日志" />
            ) : (
              <DataTable
                items={page.items}
                columns={[
                  { label: "时间", render: (row) => formatDate(read(row, "createdAt")) },
                  { label: "动作", render: (row) => safeString(read(row, "action")) },
                  { label: "对象", render: (row) => `${safeString(read(row, "objectType"))} / ${safeString(read(row, "objectId"))}` },
                  { label: "结果", render: (row) => <Badge value={safeString(read(row, "result"))} /> },
                  { label: "Request ID", render: (row) => safeString(read(row, "requestId")) }
                ]}
                onSelect={setSelected}
              />
            )
          }
        </ResourceState>
      </Panel>
      <AuditDetailPanel selected={selected} setPage={setPage} />
    </div>
  );
}

function AuditDetailPanel({ selected, setPage }: { selected: ApiRecord | null; setPage: (page: PageKey) => void }) {
  if (!selected) {
    return <Panel title="审计详情"><EmptyState title="选择一条审计日志" /></Panel>;
  }
  const objectType = safeString(read(selected, "objectType")).toLowerCase();
  const links: Array<{ label: string; page: PageKey }> = [];
  if (objectType.includes("user") || objectType.includes("department")) {
    links.push({ label: "关联部门与用户", page: "organization" });
  }
  if (objectType.includes("extension")) {
    links.push({ label: "关联扩展", page: "extensions" });
  }
  if (objectType.includes("submission") || objectType.includes("review")) {
    links.push({ label: "关联审核", page: "reviews" });
  }
  if (objectType.includes("device")) {
    links.push({ label: "关联设备", page: "devices" });
  }
  if (objectType.includes("client_update")) {
    links.push({ label: "关联更新", page: "updates" });
  }
  return (
    <Panel title="审计详情">
      <div className="detail-stack">
        <KeyValue record={selected} keys={["createdAt", "requestId", "actorId", "deviceId", "objectType", "objectId", "action", "result", "reason"]} />
        <JsonPreview title="执行前" value={read(selected, "beforeSummary")} />
        <JsonPreview title="执行后" value={read(selected, "afterSummary")} />
        <JsonPreview title="操作者快照" value={read(selected, "actorSnapshot")} />
        {links.length > 0 ? (
          <div className="button-row wrap">
            {links.map((link) => (
              <button key={link.label} type="button" className="secondary-button" onClick={() => setPage(link.page)}>
                {link.label}
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无可跳转关联对象" />
        )}
      </div>
    </Panel>
  );
}

function DevicesPage() {
  const [keyword, setKeyword] = useState("");
  const [clientVersion, setClientVersion] = useState("");
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const devices = useResource(
    () => adminApi.devices.list({ keyword, clientVersion, pageSize: 20 }),
    [keyword, clientVersion]
  );
  const distribution = useResource(() => adminApi.devices.versionDistribution(), []);
  const deviceId = selected ? safeString(read(selected, "deviceId")) : "";
  const detail = useResource(() => (deviceId ? adminApi.devices.detail(deviceId) : Promise.resolve(null)), [deviceId]);

  return (
    <div className="split-page wide-detail">
      <div className="page-grid">
        <Panel title="版本分布">
          <ResourceState resource={distribution} compact>
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="暂无设备版本数据" />
              ) : (
                <div className="distribution-list">
                  {items.map((item) => (
                    <button key={safeString(read(item, "clientVersion"))} type="button" onClick={() => setClientVersion(safeString(read(item, "clientVersion")))}>
                      <span>{safeString(read(item, "clientVersion"))}</span>
                      <strong>{safeString(read(item, "deviceCount"))}</strong>
                    </button>
                  ))}
                </div>
              )
            }
          </ResourceState>
        </Panel>
        <Panel
          title="客户端设备"
          actions={<input className="compact-input" placeholder="设备 ID" value={keyword} onChange={(event) => setKeyword(event.target.value)} />}
        >
          <ResourceState resource={devices}>
            {(page) =>
              page.items.length === 0 ? (
                <EmptyState title="暂无客户端设备" />
              ) : (
                <DataTable
                  items={page.items}
                  columns={[
                    { label: "设备", render: (row) => safeString(read(row, "deviceId")) },
                    { label: "用户", render: (row) => safeString(read(row, "userSnapshot.name", "userSnapshot")) },
                    { label: "版本", render: (row) => safeString(read(row, "clientVersion")) },
                    { label: "状态", render: (row) => <Badge value={safeString(read(row, "status"))} /> },
                    { label: "最后在线", render: (row) => formatDate(read(row, "lastSeenAt")) }
                  ]}
                  onSelect={setSelected}
                />
              )
            }
          </ResourceState>
        </Panel>
      </div>
      <Panel title="设备详情">
        <ResourceState resource={detail}>
          {(item) =>
            item ? (
              <div className="detail-stack">
                <KeyValue record={item} keys={["deviceId", "clientVersion", "osVersion", "arch", "status", "recentUpdateStatus", "recentErrorSummary"]} />
                <JsonPreview title="设备事件" value={read(item, "events")} />
                <JsonPreview title="更新事件" value={read(item, "updateEvents")} />
              </div>
            ) : (
              <EmptyState title="选择一台设备" />
            )
          }
        </ResourceState>
      </Panel>
    </div>
  );
}

function ClientUpdatesPage() {
  const [status, setStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [form, setForm] = useState({
    version: "",
    buildNo: "",
    packageTempUploadId: "",
    packageSha256: "",
    packageSize: "",
    signatureStatus: "UNKNOWN",
    releaseNotes: "",
    reason: ""
  });
  const [error, setError] = useState<ViewError | null>(null);
  const [success, setSuccess] = useState("");
  const versions = useResource(() => adminApi.updates.list({ status, pageSize: 20 }), [status, refreshKey]);
  const events = useResource(() => adminApi.updates.events({ pageSize: 10 }), [refreshKey]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess("");
    try {
      const response = await adminApi.updates.create({
        ...form,
        packageSize: Number(form.packageSize),
        platform: "WINDOWS",
        arch: "X64",
        channel: "STABLE",
        forceUpdate: false
      });
      setSuccess(`版本已创建：${safeString(read(response, "id", "version"))}`);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  async function transition(version: ApiRecord, action: "publish" | "pause" | "withdraw") {
    setError(null);
    setSuccess("");
    try {
      await adminApi.updates.transition(safeString(read(version, "id")), action, {
        expectedStatus: safeString(read(version, "status")),
        reason: form.reason || action
      });
      setSuccess("状态已更新");
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <div className="split-page">
      <Panel title="客户端版本" actions={<Select value={status} onChange={setStatus} options={["", "DRAFT", "PUBLISHED", "PAUSED", "WITHDRAWN"]} />}>
        {success ? <p className="success-text">{success}</p> : null}
        {error ? <InlineError error={error} /> : null}
        <ResourceState resource={versions}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState title="暂无客户端版本" />
            ) : (
              <DataTable
                items={page.items}
                columns={[
                  { label: "版本", render: (row) => safeString(read(row, "version")) },
                  { label: "签名", render: (row) => safeString(read(row, "signature_status", "signatureStatus")) },
                  { label: "状态", render: (row) => <Badge value={safeString(read(row, "status"))} /> },
                  { label: "创建时间", render: (row) => formatDate(read(row, "created_at", "createdAt")) },
                  {
                    label: "操作",
                    render: (row) => (
                      <div className="inline-actions">
                        <button type="button" onClick={() => transition(row, "publish")}>发布</button>
                        <button type="button" onClick={() => transition(row, "pause")}>暂停</button>
                        <button type="button" onClick={() => transition(row, "withdraw")}>撤回</button>
                      </div>
                    )
                  }
                ]}
              />
            )
          }
        </ResourceState>
        <ResourceState resource={events} compact>
          {(page) => <JsonPreview title="最近更新事件" value={page.items} />}
        </ResourceState>
      </Panel>
      <Panel title="创建客户端版本">
        <form className="form-stack" onSubmit={create}>
          <input placeholder="版本号，例如 1.2.3" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} />
          <input placeholder="构建号" value={form.buildNo} onChange={(event) => setForm({ ...form, buildNo: event.target.value })} />
          <input placeholder="临时上传 ID" value={form.packageTempUploadId} onChange={(event) => setForm({ ...form, packageTempUploadId: event.target.value })} />
          <input placeholder="SHA-256" value={form.packageSha256} onChange={(event) => setForm({ ...form, packageSha256: event.target.value })} />
          <input placeholder="包大小 Byte" value={form.packageSize} onChange={(event) => setForm({ ...form, packageSize: event.target.value })} />
          <select value={form.signatureStatus} onChange={(event) => setForm({ ...form, signatureStatus: event.target.value })}>
            <option value="UNKNOWN">UNKNOWN</option>
            <option value="VALID">VALID</option>
            <option value="INVALID">INVALID</option>
          </select>
          <textarea placeholder="发布说明" value={form.releaseNotes} onChange={(event) => setForm({ ...form, releaseNotes: event.target.value })} />
          <textarea placeholder="原因" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          <button className="primary-button" type="submit">创建草稿</button>
        </form>
      </Panel>
    </div>
  );
}

function SettingsPage() {
  const [keyword, setKeyword] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [valueJson, setValueJson] = useState("");
  const [reason, setReason] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<ViewError | null>(null);
  const [success, setSuccess] = useState("");
  const settings = useResource(() => adminApi.settings.list({ keyword, pageSize: 20 }), [keyword, refreshKey]);
  const detail = useResource(() => (selectedKey ? adminApi.settings.detail(selectedKey) : Promise.resolve(null)), [selectedKey, refreshKey]);

  useEffect(() => {
    if (detail.status === "success" && detail.data) {
      setValueJson(JSON.stringify(read(detail.data, "value"), null, 2));
    }
  }, [detail]);

  async function save() {
    if (detail.status !== "success" || !detail.data) {
      return;
    }
    setError(null);
    setSuccess("");
    try {
      await adminApi.settings.update(selectedKey, {
        value: JSON.parse(valueJson),
        expectedVersion: Number(read(detail.data, "version")),
        reason
      });
      setSuccess("设置已保存");
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <div className="split-page">
      <Panel
        title="系统设置"
        actions={<input className="compact-input" placeholder="搜索 key" value={keyword} onChange={(event) => setKeyword(event.target.value)} />}
      >
        <ResourceState resource={settings}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState title="暂无设置" />
            ) : (
              <DataTable
                items={page.items}
                columns={[
                  { label: "Key", render: (row) => safeString(read(row, "key")) },
                  { label: "版本", render: (row) => safeString(read(row, "version")) },
                  { label: "更新时间", render: (row) => formatDate(read(row, "updatedAt")) }
                ]}
                onSelect={(row) => setSelectedKey(safeString(read(row, "key")))}
              />
            )
          }
        </ResourceState>
      </Panel>
      <Panel title="设置详情">
        <ResourceState resource={detail}>
          {(item) =>
            item ? (
              <div className="form-stack">
                <KeyValue record={item} keys={["key", "version", "updatedBy", "updatedAt"]} />
                <textarea className="json-editor" value={valueJson} onChange={(event) => setValueJson(event.target.value)} />
                <textarea placeholder="变更原因" value={reason} onChange={(event) => setReason(event.target.value)} />
                {error ? <InlineError error={error} /> : null}
                {success ? <p className="success-text">{success}</p> : null}
                <button className="primary-button" type="button" onClick={save}>保存设置</button>
              </div>
            ) : (
              <EmptyState title="选择一个设置项" />
            )
          }
        </ResourceState>
      </Panel>
    </div>
  );
}

function NotificationsDrawer({ onClose }: { onClose: () => void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const resource = useResource(() => adminApi.notifications.list({ pageSize: 20 }), [refreshKey]);

  async function markRead(notificationId: string) {
    await adminApi.notifications.read(notificationId);
    setRefreshKey((value) => value + 1);
  }

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <h3>通知</h3>
          <button type="button" className="icon-button" onClick={onClose}>关闭</button>
        </header>
        <ResourceState resource={resource}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState title="暂无通知" />
            ) : (
              <RecordList
                items={page.items}
                empty="暂无通知"
                primary={(item) => safeString(read(item, "title"))}
                secondary={(item) => safeString(read(item, "summary"))}
                action={(item) => (
                  <button type="button" onClick={() => markRead(safeString(read(item, "id")))}>
                    已读
                  </button>
                )}
              />
            )
          }
        </ResourceState>
      </aside>
    </div>
  );
}

function ChangePasswordModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<ViewError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await adminApi.auth.changePassword(oldPassword, newPassword);
      onChanged();
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-panel form-stack" onSubmit={submit}>
        <div className="modal-title">
          <h3>修改密码</h3>
          <button type="button" className="icon-button" onClick={onClose}>关闭</button>
        </div>
        <input type="password" placeholder="旧密码" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
        <input type="password" placeholder="新密码" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        {error ? <InlineError error={error} /> : null}
        <button className="primary-button" type="submit">保存</button>
      </form>
    </div>
  );
}

function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h3>{title}</h3>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value, tone, onClick }: { label: string; value: number; tone?: string; onClick: () => void }) {
  return (
    <button type="button" className={`metric-card ${tone ?? ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function ResourceState<T>({
  resource,
  children,
  compact
}: {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
  compact?: boolean;
}) {
  if (resource.status === "loading") {
    return <StateBlock title={compact ? "加载中" : "正在加载"} />;
  }
  if (resource.status === "error") {
    return <InlineError error={resource.error} />;
  }
  return <>{children(resource.data)}</>;
}

function StateBlock({ title }: { title: string }) {
  return <div className="state-block">{title}</div>;
}

function EmptyState({ title }: { title: string }) {
  return <div className="empty-state">{title}</div>;
}

function PermissionState({ title, message }: { title: string; message: string }) {
  return (
    <section className="panel permission-state">
      <h3>{title}</h3>
      <p>{message}</p>
    </section>
  );
}

function ErrorBanner({ error, onClose }: { error: ViewError; onClose: () => void }) {
  return (
    <div className="error-banner">
      <InlineError error={error} />
      <button type="button" onClick={onClose}>关闭</button>
    </div>
  );
}

function InlineError({ error }: { error: ViewError }) {
  return (
    <div className="inline-error" role="alert">
      <strong>{error.message}</strong>
      {error.code ? <span>错误码：{error.code}</span> : null}
      {error.requestId ? <span>Request ID：{error.requestId}</span> : null}
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("fail") || normalized.includes("reject") || normalized.includes("security")
    ? "danger"
    : normalized.includes("pending") || normalized.includes("draft") || normalized.includes("paused")
      ? "warning"
      : normalized.includes("success") || normalized.includes("active") || normalized.includes("published")
        ? "success"
        : "neutral";
  return <span className={`badge ${tone}`}>{value || "未知"}</span>;
}

function DataTable<T extends ApiRecord>({
  items,
  columns,
  onSelect
}: {
  items: T[];
  columns: Array<{ label: string; render: (row: T) => ReactNode }>;
  onSelect?: (row: T) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, index) => (
            <tr key={safeString(read(row, "id", "submissionId", "extensionId", "deviceId")) || index} onClick={() => onSelect?.(row)}>
              {columns.map((column) => (
                <td key={column.label}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordList({
  items,
  empty,
  primary,
  secondary,
  action
}: {
  items: ApiRecord[];
  empty: string;
  primary: (item: ApiRecord) => string;
  secondary: (item: ApiRecord) => string;
  action?: (item: ApiRecord) => ReactNode;
}) {
  if (items.length === 0) {
    return <EmptyState title={empty} />;
  }
  return (
    <div className="record-list">
      {items.map((item, index) => (
        <div className="record-row" key={safeString(read(item, "id", "submissionId", "requestId")) || index}>
          <div>
            <strong>{primary(item)}</strong>
            <span>{secondary(item)}</span>
          </div>
          {action ? action(item) : null}
        </div>
      ))}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option || "all"} value={option}>
          {option || "全部"}
        </option>
      ))}
    </select>
  );
}

function TreeList({ items, onAction }: { items: ApiRecord[]; onAction: (id: string, action: "enable" | "disable") => void }) {
  return (
    <ul className="tree-list">
      {items.map((item) => {
        const id = safeString(read(item, "id"));
        return (
          <li key={id}>
            <div className="tree-row">
              <span>{safeString(read(item, "name"))}</span>
              <Badge value={safeString(read(item, "status"))} />
              <span>{safeString(read(item, "userCount"))} 人</span>
              <button type="button" onClick={() => onAction(id, "enable")}>启用</button>
              <button type="button" onClick={() => onAction(id, "disable")}>停用</button>
            </div>
            {Array.isArray(read(item, "children")) ? (
              <TreeList items={read(item, "children") as ApiRecord[]} onAction={onAction} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function KeyValue({ record, keys }: { record: ApiRecord; keys: string[] }) {
  return (
    <dl className="key-value">
      {keys.map((key) => {
        const value = read(record, key);
        if (value === undefined || value === null || value === "") {
          return null;
        }
        return (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{safeString(value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function JsonPreview({ value, title }: { value: unknown; title?: string }) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return (
    <div className="json-preview">
      {title ? <strong>{title}</strong> : null}
      <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function useResource<T>(loader: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setResource({ status: "loading" });
    loader()
      .then((data) => {
        if (!cancelled) {
          setResource({ status: "success", data });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setResource({ status: "error", error: normalizeError(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, deps);
  return resource;
}

function normalizeError(error: unknown): ViewError {
  if (error instanceof AdminApiError) {
    return {
      message: error.message,
      code: error.code,
      requestId: error.requestId
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "操作失败" };
}

function isAdminRole(role: Role): boolean {
  return role === "DEPARTMENT_ADMIN" || role === "SYSTEM_ADMIN";
}

function roleLabel(role: Role): string {
  if (role === "SYSTEM_ADMIN") {
    return "系统管理员";
  }
  if (role === "DEPARTMENT_ADMIN") {
    return "部门管理员";
  }
  return "普通用户";
}

function read(record: unknown, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = readOne(record, key);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function readOne(record: unknown, path: string): unknown {
  if (!record || typeof record !== "object") {
    return undefined;
  }
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as ApiRecord)[part];
  }, record);
}

function safeString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object" && "name" in value && typeof (value as ApiRecord).name === "string") {
    return (value as ApiRecord).name as string;
  }
  return JSON.stringify(value);
}

function formatDate(value: unknown): string {
  if (!value) {
    return "";
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return safeString(value);
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}
