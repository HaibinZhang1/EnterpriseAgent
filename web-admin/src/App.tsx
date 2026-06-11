import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
type AuditQueryState = { action: string; result: string; objectType: string; objectId: string };
type AuditQueryPreset = Partial<AuditQueryState> & { nonce: number };

interface SessionState {
  token: string;
  user: UserSummary;
}

interface ViewError {
  message: string;
  code?: string;
  requestId?: string;
  details?: unknown;
}

type Resource<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ViewError };

type ReviewAction = "approve" | "request-changes" | "reject";
export type GovernanceAction = "delist" | "security-delist" | "relist" | "scope/reduce" | "visibility/reduce" | "archive" | "ownership-transfer";

const emptyPage: PageResult<ApiRecord> = { items: [], page: 1, pageSize: 20, total: 0, hasNext: false };
export const defaultGovernanceTargetScopeJson = JSON.stringify({
  scopeType: "DEPARTMENT",
  departments: [
    {
      departmentId: "",
      includeChildren: false
    }
  ]
}, null, 2);

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
  const [auditPreset, setAuditPreset] = useState<AuditQueryPreset | null>(null);
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
        <PageRouter
          page={activePage}
          user={session.user}
          setPage={setActivePage}
          auditPreset={auditPreset}
          openAudit={(query) => {
            setAuditPreset({ ...query, nonce: Date.now() });
            setActivePage("audit");
          }}
        />
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

export function PageRouter({
  page,
  user,
  setPage,
  auditPreset = null,
  openAudit = () => undefined
}: {
  page: PageKey;
  user: UserSummary;
  setPage: (page: PageKey) => void;
  auditPreset?: AuditQueryPreset | null;
  openAudit?: (query: Partial<AuditQueryState>) => void;
}) {
  if ((page === "updates" || page === "settings") && user.role !== "SYSTEM_ADMIN") {
    return <PermissionState title="无权访问" message="客户端更新和系统设置仅系统管理员可见。" />;
  }
  switch (page) {
    case "overview":
      return <OverviewPage user={user} setPage={setPage} />;
    case "reviews":
      return <ReviewsPage />;
    case "extensions":
      return <ExtensionsPage openAudit={openAudit} />;
    case "organization":
      return <OrganizationPage />;
    case "audit":
      return <AuditPage setPage={setPage} preset={auditPreset} />;
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
  const [keyword, setKeyword] = useState("");
  const [submitter, setSubmitter] = useState("");
  const [type, setType] = useState("");
  const [timeSort, setTimeSort] = useState("submitted_desc");
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const resource = useResource(
    () => adminApi.reviews.list({ status, keyword, submitter, type, sort: timeSort, pageSize: 20 }),
    [status, keyword, submitter, type, timeSort, refreshKey]
  );
  const filterActions = (
    <div className="filter-row" aria-label="审核筛选">
      <input className="compact-input" aria-label="审核关键词搜索" placeholder="extensionId / 申请 ID" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      <input className="compact-input" aria-label="提交人筛选" placeholder="提交人" value={submitter} onChange={(event) => setSubmitter(event.target.value)} />
      <Select value={type} onChange={setType} options={["", "SKILL", "MCP_SERVER", "PLUGIN"]} ariaLabel="类型筛选" />
      <Select value={status} onChange={setStatus} options={["PENDING", "APPROVED", "CHANGES_REQUESTED", "REJECTED"]} ariaLabel="状态筛选" />
      <Select value={timeSort} onChange={setTimeSort} options={["submitted_desc", "submitted_asc"]} ariaLabel="提交时间排序" />
    </div>
  );

  return (
    <div className="split-page">
      <Panel title="审核列表" actions={filterActions}>
        <ResourceState resource={resource}>
          {(page) => {
            const items = page.items;
            return items.length === 0 ? (
              <EmptyState title="暂无审核任务" />
            ) : (
              <DataTable
                items={items}
                columns={[
                  {
                    label: "申请 ID",
                    render: (row) => {
                      const id = safeString(read(row, "submissionId", "id"));
                      return (
                        <span className="inline-actions">
                          <span>{id || "-"}</span>
                          {id ? <button type="button" aria-label={`复制申请 ID ${id}`} onClick={(event) => { event.stopPropagation(); copyText(id); }}>复制</button> : null}
                        </span>
                      );
                    }
                  },
                  { label: "扩展", render: (row) => safeString(read(row, "extensionName", "name", "extensionId")) },
                  { label: "类型", render: (row) => safeString(read(row, "extensionType", "type")) },
                  { label: "提交人", render: (row) => safeString(read(row, "submitterName", "submittedByName", "applicantName", "submitter.name")) },
                  { label: "状态", render: (row) => <Badge value={safeString(read(row, "status"))} /> },
                  { label: "提交时间", render: (row) => formatDate(read(row, "submittedAt", "createdAt")) }
                ]}
                onSelect={setSelected}
              />
            );
          }}
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

  async function decide(action: ReviewAction, detail: ApiRecord) {
    const normalizedComment = comment.trim();
    if (reviewActionRequiresReason(action) && !normalizedComment) {
      setError({ message: "退回修改和拒绝必须填写审核原因。" });
      return;
    }
    setBusyAction(action);
    setError(null);
    try {
      const revisionId = safeString(read(detail, "revisionId", "currentRevisionId", "revision.id"));
      await adminApi.reviews.decision(submissionId, action, {
        revisionId: revisionId || undefined,
        comment: normalizedComment,
        reasonCodes: normalizedComment ? ["MANUAL_REVIEW"] : []
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
              <ReviewDetailSections detail={detail} />
              <label>
                审核意见
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
              </label>
              {error ? <InlineError error={error} /> : null}
              <ReviewDecisionButtons busyAction={busyAction} comment={comment} onDecide={(action) => decide(action, detail)} />
            </div>
          );
        }}
      </ResourceState>
    </Panel>
  );
}

export function ReviewDetailSections({ detail }: { detail: ApiRecord }) {
  const latestRevision = currentReviewRevision(detail);
  const revisionPayload = unwrapEnvelope(read(latestRevision, "payloadSnapshot"));
  const packageSnapshot = unwrapEnvelope(read(latestRevision, "packageSnapshot"));
  const revisionData = mergeRecords(revisionPayload, packageSnapshot, latestRevision);
  const precheck = currentReviewPrecheck(detail, latestRevision);
  const systemCheck = withPrecheckStatus(
    read(detail, "systemCheck", "systemChecks", "rulePrecheck", "policyPrecheck", "validationResults") ?? read(precheck, "ruleResult"),
    precheck,
    ["ruleStatus", "rule_status"]
  );
  const aiPrecheck = withPrecheckStatus(
    read(detail, "aiPrecheck", "precheck", "aiReview") ?? read(precheck, "aiResultSummary"),
    precheck,
    ["aiStatus", "ai_status"]
  );
  const extensionType = safeString(read(detail, "extensionType", "type", "latestRevision.type", "latestRevision.extensionType") ?? read(revisionData, "extensionType", "type"));
  const typedPreview = mergeRecords(
    read(packageSnapshot, "precheck.definition"),
    read(revisionData, "precheck.definition"),
    read(revisionData, "typePayload", "definition", "manifest", "packageMetadata"),
    revisionData,
    read(detail, "typedPreview", "definition", "manifest", "latestRevision.definition")
  ) ?? read(detail, "typedPreview", "definition", "manifest", "latestRevision.definition") ?? revisionData ?? latestRevision;

  return (
    <>
      <DetailSection title="顶部摘要">
        <FieldGrid
          fields={[
            field("申请 ID", read(detail, "submissionId", "id")),
            field("扩展名称", read(detail, "extensionName", "name", "latestRevision.name") ?? read(revisionData, "metadata.name", "name")),
            field("扩展类型", extensionType),
            field("审核状态", read(detail, "status")),
            field("提交人", read(detail, "submitterName", "submittedByName", "applicantName", "submitter.name")),
            field("提交部门", read(detail, "departmentName", "ownerDepartmentName", "submitter.departmentName")),
            field("目标版本", read(detail, "targetVersion", "version", "latestRevision.version") ?? read(revisionData, "version")),
            field("提交时间", formatDate(read(detail, "submittedAt", "createdAt"))),
            field("风险等级", read(detail, "riskLevel", "aiPrecheck.riskLevel", "precheck.riskLevel") ?? read(aiPrecheck, "riskLevel")),
            field("AI 预审状态", read(detail, "aiPrecheckStatus", "aiStatus", "precheck.status") ?? read(aiPrecheck, "status"))
          ]}
        />
      </DetailSection>

      <DetailSection title="本次申请内容">
        <FieldGrid
          fields={[
            field("申请类型", read(detail, "applicationType", "submissionType", "changeType", "type") ?? read(revisionData, "type")),
            field("扩展 ID", read(detail, "extensionId", "latestRevision.extensionId") ?? read(revisionData, "extensionId")),
            field("当前版本", read(detail, "currentVersion", "previousVersion")),
            field("目标版本", read(detail, "targetVersion", "latestRevision.version") ?? read(revisionData, "version")),
            field("变更摘要", read(detail, "changeSummary", "summary", "description", "latestRevision.description") ?? read(revisionData, "metadata.description", "description")),
            field("申请原因", read(detail, "reason", "submitReason", "businessReason") ?? read(revisionData, "riskStatement.reason", "riskStatement.summary"))
          ]}
        />
      </DetailSection>

      <DetailSection title="系统校验结果">
        <SystemCheckResult value={systemCheck} />
      </DetailSection>

      <DetailSection title="AI 系统预审结果">
        <AiPrecheckResult value={aiPrecheck} />
      </DetailSection>

      <DetailSection title="包摘要与文件清单">
        <PackageSnapshotSummary value={packageSnapshot} />
      </DetailSection>

      <DetailSection title={`${reviewTypeLabel(extensionType)}内容预览`}>
        <TypedContentPreview detail={detail} extensionType={extensionType} value={typedPreview} />
      </DetailSection>

      <DetailSection title="授权、可见选项与影响范围">
        <FieldGrid
          fields={[
            field("当前可见性", read(detail, "visibilityMode", "currentVisibilityMode", "latestRevision.visibilityMode")),
            field("目标可见性", read(detail, "targetVisibilityMode") ?? read(revisionData, "visibilityMode")),
            field("当前授权范围", read(detail, "scope", "currentScope", "latestRevision.scope")),
            field("目标授权范围", read(detail, "targetScope")),
            field("影响部门", read(detail, "impactDepartments", "impactDepartmentNames", "targetDepartments")),
            field("影响用户数", read(detail, "impactUserCount", "affectedUserCount")),
            field("授权变更", read(detail, "authorizationImpact", "permissionImpact", "scopeChangeSummary") ?? read(revisionData, "authorizationScope"))
          ]}
        />
      </DetailSection>

      <DetailSection title="风险声明">
        <FieldGrid
          fields={[
            field("风险等级", read(detail, "riskLevel", "aiPrecheck.riskLevel", "precheck.riskLevel") ?? read(aiPrecheck, "riskLevel")),
            field("风险摘要", read(detail, "riskSummary", "riskStatement", "aiPrecheck.summary", "precheck.summary") ?? read(revisionData, "riskStatement.summary", "riskStatement")),
            field("敏感能力", read(detail, "sensitiveCapabilities", "permissions", "latestRevision.permissions") ?? read(typedPreview, "permissions")),
            field("安全说明", read(detail, "securityNotes", "sensitiveInfoWarning", "privacyStatement"))
          ]}
        />
      </DetailSection>

      <DetailSection title="历史记录与审核意见">
        <HistorySummary value={read(detail, "reviewHistory", "history", "events", "comments", "decisionHistory")} />
      </DetailSection>

      <AdvancedJsonDetails
        items={[
          ["payloadSnapshot", revisionPayload],
          ["packageSnapshot", packageSnapshot],
          ["latestRevision", latestRevision],
          ["prechecks", read(detail, "prechecks")]
        ]}
      />
    </>
  );
}

export function ReviewDecisionButtons({
  busyAction,
  comment,
  onDecide
}: {
  busyAction: string | null;
  comment: string;
  onDecide: (action: ReviewAction) => void;
}) {
  const hasReason = comment.trim().length > 0;
  return (
    <div className="button-row">
      <button className="primary-button" type="button" disabled={!!busyAction} onClick={() => onDecide("approve")}>
        {busyAction === "approve" ? "处理中" : "通过"}
      </button>
      <button
        className="secondary-button"
        type="button"
        disabled={!!busyAction || !hasReason}
        onClick={() => onDecide("request-changes")}
      >
        要求修改
      </button>
      <button className="danger-button" type="button" disabled={!!busyAction || !hasReason} onClick={() => onDecide("reject")}>
        驳回
      </button>
    </div>
  );
}

function ExtensionsPage({ openAudit }: { openAudit: (query: Partial<AuditQueryState>) => void }) {
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [visibilityMode, setVisibilityMode] = useState("");
  const [ownerDepartmentId, setOwnerDepartmentId] = useState("");
  const [includeChildren, setIncludeChildren] = useState(false);
  const [maintainerId, setMaintainerId] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const resource = useResource(
    () => adminApi.extensions.list({
      keyword,
      type,
      status,
      visibilityMode,
      ownerDepartmentId,
      includeChildren,
      maintainerId,
      riskLevel,
      pageSize: 20
    }),
    [keyword, type, status, visibilityMode, ownerDepartmentId, includeChildren, maintainerId, riskLevel, refreshKey]
  );

  return (
    <div className="split-page">
      <Panel
        title="扩展管理"
        actions={
          <div className="filter-row">
            <input className="compact-input" aria-label="扩展关键词搜索" placeholder="Extension ID / 名称 / 人员" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <Select value={type} onChange={setType} options={["", "SKILL", "MCP_SERVER", "PLUGIN"]} ariaLabel="扩展类型筛选" />
            <Select value={status} onChange={setStatus} options={["", "PUBLISHED", "DELISTED", "SECURITY_DELISTED", "ARCHIVED"]} ariaLabel="扩展状态筛选" />
            <Select value={visibilityMode} onChange={setVisibilityMode} options={["", "PUBLIC_TO_ALL_LOGGED_IN", "AUTHORIZED_ONLY"]} ariaLabel="扩展可见性筛选" />
            <Select value={riskLevel} onChange={setRiskLevel} options={["", "LOW", "MEDIUM", "HIGH"]} ariaLabel="扩展风险等级筛选" />
            <input className="compact-input" aria-label="归属部门 ID 筛选" placeholder="归属部门 ID" value={ownerDepartmentId} onChange={(event) => setOwnerDepartmentId(event.target.value)} />
            <label className="check-row compact-check">
              <input type="checkbox" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
              含下级
            </label>
            <input className="compact-input" aria-label="维护人 ID 筛选" placeholder="维护人 ID" value={maintainerId} onChange={(event) => setMaintainerId(event.target.value)} />
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
                  { label: "版本", render: (row) => safeString(read(row, "currentVersion", "version")) },
                  { label: "状态", render: (row) => <Badge value={safeString(read(row, "status"))} /> },
                  { label: "可见性", render: (row) => safeString(read(row, "visibilityMode")) },
                  { label: "维护人", render: (row) => safeString(read(row, "maintainer.name", "maintainerName", "maintainerId")) },
                  { label: "归属部门", render: (row) => safeString(read(row, "ownerDepartment.name", "ownerDepartmentName", "ownerDepartmentId")) },
                  { label: "风险", render: (row) => <Badge value={safeString(read(row, "riskLevel"))} /> },
                  { label: "统计", render: (row) => extensionMetricSummary(row) }
                ]}
                onSelect={setSelected}
              />
            )
          }
        </ResourceState>
      </Panel>
      <ExtensionDetailPanel selected={selected} onChanged={() => setRefreshKey((value) => value + 1)} openAudit={openAudit} />
    </div>
  );
}

function ExtensionDetailPanel({
  selected,
  onChanged,
  openAudit
}: {
  selected: ApiRecord | null;
  onChanged: () => void;
  openAudit: (query: Partial<AuditQueryState>) => void;
}) {
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
  const [targetScope, setTargetScope] = useState(defaultGovernanceTargetScopeJson);
  const [targetMaintainerId, setTargetMaintainerId] = useState("");
  const [targetOwnerDepartmentId, setTargetOwnerDepartmentId] = useState("");
  const [securityReason, setSecurityReason] = useState("");
  const [impactSummary, setImpactSummary] = useState("");
  const [handlingAdvice, setHandlingAdvice] = useState("");
  const [busyAction, setBusyAction] = useState<GovernanceAction | null>(null);
  const inFlightGovernanceAction = useRef<GovernanceAction | null>(null);
  const [error, setError] = useState<ViewError | null>(null);
  const [success, setSuccess] = useState("");

  async function govern(action: GovernanceAction) {
    if (!extensionId || inFlightGovernanceAction.current) {
      return;
    }
    const normalizedReason = reason.trim();
    if (governanceActionRequiresReason(action) && !normalizedReason) {
      setError({ message: "治理动作必须填写原因；安全下架请填写安全原因、影响范围和处置建议。" });
      return;
    }
    if (action === "ownership-transfer" && !targetMaintainerId.trim() && !targetOwnerDepartmentId.trim()) {
      setError({ message: "转移维护人或归属部门至少填写一个目标 ID。" });
      return;
    }
    if (action === "archive" && typeof window !== "undefined" && !window.confirm("归档为终态，确认归档该扩展？")) {
      return;
    }
    setError(null);
    setSuccess("");
    inFlightGovernanceAction.current = action;
    setBusyAction(action);
    try {
      await adminApi.extensions.govern(extensionId, action, buildExtensionGovernancePayload(action, {
        reason,
        targetVisibilityMode,
        targetScopeJson: targetScope,
        targetMaintainerId,
        targetOwnerDepartmentId,
        securityReason,
        impactSummary,
        handlingAdvice
      }));
      setSuccess("治理动作已提交");
      onChanged();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      inFlightGovernanceAction.current = null;
      setBusyAction(null);
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
              <ExtensionDetailSections
                detail={detail}
                versions={versionsResource.status === "success" ? versionsResource.data : undefined}
              />
              <div className="button-row wrap">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openAudit({
                    objectType: "extension",
                    objectId: safeString(read(detail, "audit.objectId", "id", "extensionId"))
                  })}
                >
                  查看扩展审计
                </button>
              </div>
              <ResourceState resource={versionsResource} compact>
                {(versions) => (
                  <DetailSection title="版本历史">
                    <JsonOrEmpty value={versions} />
                  </DetailSection>
                )}
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
              <DetailSection title="维护人/归属部门转移">
                <div className="form-grid-two">
                  <label>
                    目标维护人 ID
                    <input value={targetMaintainerId} onChange={(event) => setTargetMaintainerId(event.target.value)} />
                  </label>
                  <label>
                    目标归属部门 ID
                    <input value={targetOwnerDepartmentId} onChange={(event) => setTargetOwnerDepartmentId(event.target.value)} />
                  </label>
                </div>
              </DetailSection>
              <DetailSection title="安全下架信息">
                <label>
                  安全原因
                  <textarea value={securityReason} onChange={(event) => setSecurityReason(event.target.value)} />
                </label>
                <label>
                  影响范围
                  <textarea value={impactSummary} onChange={(event) => setImpactSummary(event.target.value)} />
                </label>
                <label>
                  处置建议
                  <textarea value={handlingAdvice} onChange={(event) => setHandlingAdvice(event.target.value)} />
                </label>
              </DetailSection>
              {error ? <InlineError error={error} /> : null}
              {success ? <p className="success-text">{success}</p> : null}
              <ExtensionGovernanceButtons
                reason={reason}
                securityDelistReady={[securityReason, impactSummary, handlingAdvice].every((value) => value.trim().length > 0)}
                ownershipTransferReady={!!targetMaintainerId.trim() || !!targetOwnerDepartmentId.trim()}
                busyAction={busyAction}
                onGovern={govern}
              />
            </div>
          );
        }}
      </ResourceState>
    </Panel>
  );
}

export function ExtensionDetailSections({ detail, versions }: { detail: ApiRecord; versions?: unknown }) {
  const latestVersion = firstRecord(versions) ?? asRecord(read(detail, "latestVersion", "currentVersionDetail"));
  const versionPayload = unwrapEnvelope(read(latestVersion, "payloadSnapshot"));
  const packageSnapshot = unwrapEnvelope(read(latestVersion, "packageSnapshot"));
  const versionData = mergeRecords(versionPayload, packageSnapshot, latestVersion);
  const extensionType = safeString(read(detail, "type", "extensionType", "latestVersion.type") ?? read(versionData, "extensionType", "type"));
  const typedPreview = mergeRecords(
    read(packageSnapshot, "precheck.definition"),
    read(versionData, "precheck.definition"),
    read(versionData, "typePayload", "definition", "manifest", "packageMetadata"),
    versionData,
    read(detail, "definition", "manifest", "packageMetadata", "latestVersion.definition", "latestVersion.manifest")
  ) ?? read(detail, "definition", "manifest", "packageMetadata", "latestVersion.definition", "latestVersion.manifest") ?? versionData;

  return (
    <>
      <DetailSection title="基础信息">
        <FieldGrid
          fields={[
            field("扩展 ID", read(detail, "extensionId", "id")),
            field("名称", read(detail, "name", "extensionName")),
            field("类型", extensionType),
            field("状态", read(detail, "status")),
            field("当前版本", read(detail, "version", "currentVersion", "latestVersion.version") ?? read(latestVersion, "version")),
            field("作者", read(detail, "authorSnapshot.name", "authorName", "author", "publisherName")),
            field("维护人", read(detail, "maintainer.name", "maintainerName", "maintainerId")),
            field("归属部门", read(detail, "ownerDepartment.name", "ownerDepartmentName", "departmentName", "publisherDepartmentName")),
            field("更新时间", formatDate(read(detail, "updatedAt", "publishedAt", "createdAt")))
          ]}
        />
      </DetailSection>

      <DetailSection title="维护人与归属部门">
        <FieldGrid
          fields={[
            field("作者 ID", read(detail, "authorId", "authorSnapshot.id")),
            field("维护人 ID", read(detail, "maintainerId", "maintainer.id")),
            field("维护人名称", read(detail, "maintainer.name", "maintainerName")),
            field("归属部门 ID", read(detail, "ownerDepartmentId", "ownerDepartment.id")),
            field("归属部门名称", read(detail, "ownerDepartment.name", "ownerDepartmentName")),
            field("归属部门状态", read(detail, "ownerDepartment.status"))
          ]}
        />
      </DetailSection>

      <DetailSection title="授权与可见范围">
        <FieldGrid
          fields={[
            field("可见性", read(detail, "visibilityMode")),
            field("授权类型", read(detail, "scope.scopeType", "authorizedScope.scopeType")),
            field("授权范围", read(detail, "scope", "authorizedScope")),
            field("可见部门", read(detail, "visibleDepartments", "departmentScope")),
            field("可用用户数", read(detail, "authorizedUserCount", "visibleUserCount")),
            field("收缩建议", read(detail, "scopeReductionSuggestion", "visibilitySuggestion"))
          ]}
        />
      </DetailSection>

      <DetailSection title="发布与审核状态">
        <FieldGrid
          fields={[
            field("审核状态", read(detail, "reviewStatus", "latestReviewStatus")),
            field("AI 预审状态", read(detail, "aiPrecheckStatus", "aiStatus", "precheck.status")),
            field("最近申请", read(detail, "latestSubmissionId", "submissionId")),
            field("发布时间", formatDate(read(detail, "publishedAt"))),
            field("下架原因", read(detail, "delistReason", "securityReason", "archiveReason"))
          ]}
        />
      </DetailSection>

      <DetailSection title="使用统计与风险">
        <FieldGrid
          fields={[
            field("Star 数", read(detail, "metrics.stars", "starCount")),
            field("下载用户数", read(detail, "metrics.downloads", "installCount", "installationCount")),
            field("近 7 天下载用户", read(detail, "metrics.weeklyDownloads")),
            field("MCP 使用用户", read(detail, "metrics.mcpUsageUsers", "usageCount", "invocationCount")),
            field("MCP 连接检测失败", read(detail, "metrics.mcpConnectionFailures")),
            field("Plugin 安装用户", read(detail, "metrics.pluginInstallUsers")),
            field("Plugin 卸载失败", read(detail, "metrics.pluginUninstallFailures")),
            field("本地事件失败", read(detail, "metrics.localEventFailures", "abnormalEventCount", "exceptionCount")),
            field("活跃用户", read(detail, "metrics.activeUsers", "activeUserCount")),
            field("风险等级", read(detail, "riskLevel", "aiPrecheck.riskLevel", "precheck.riskLevel")),
            field("风险摘要", read(detail, "riskSummary", "aiPrecheck.summary", "precheck.summary"))
          ]}
        />
        <JsonOrEmpty value={read(detail, "metrics.metricAggregates")} />
      </DetailSection>

      <DetailSection title={`${reviewTypeLabel(extensionType)}内容详情`}>
        <TypedContentPreview detail={detail} extensionType={extensionType} value={typedPreview} />
      </DetailSection>

      <DetailSection title="审核与 AI 预审历史">
        <HistorySummary value={read(detail, "reviewHistory", "reviews", "reviewRecords")} />
        <JsonOrEmpty value={read(detail, "aiPrecheckHistory", "prechecks", "aiPrechecks")} />
      </DetailSection>

      <DetailSection title="审计入口与最近审计">
        <FieldGrid
          fields={[
            field("对象类型", read(detail, "audit.objectType")),
            field("对象 ID", read(detail, "audit.objectId", "id")),
            field("对象名称", read(detail, "audit.objectNameSnapshot", "extensionId")),
            field("审计动作", read(detail, "audit.actions"))
          ]}
        />
        <HistorySummary value={read(detail, "recentAudits", "audits", "auditLogs")} />
      </DetailSection>

      <DetailSection title="本地事件与异常">
        <JsonOrEmpty value={read(detail, "localEvents", "deviceExceptions", "exceptionEvents", "recentEvents")} />
      </DetailSection>

      <DetailSection title="维护/归属转移历史">
        <HistorySummary value={read(detail, "ownershipHistory", "ownershipTransfers")} />
      </DetailSection>
    </>
  );
}

export function ExtensionGovernanceButtons({
  reason,
  securityDelistReady = true,
  ownershipTransferReady = true,
  busyAction = null,
  onGovern
}: {
  reason: string;
  securityDelistReady?: boolean;
  ownershipTransferReady?: boolean;
  busyAction?: GovernanceAction | null;
  onGovern: (action: GovernanceAction) => void;
}) {
  const reasonMissing = reason.trim().length === 0;
  const busy = busyAction !== null;
  return (
    <div className="button-row wrap">
      <button type="button" className="secondary-button" disabled={busy || reasonMissing} onClick={() => onGovern("delist")}>下架</button>
      <button type="button" className="danger-button" disabled={busy || !securityDelistReady} onClick={() => onGovern("security-delist")}>安全下架</button>
      <button type="button" className="secondary-button" disabled={busy || reasonMissing} onClick={() => onGovern("relist")}>恢复上架</button>
      <button type="button" className="secondary-button" disabled={busy || reasonMissing} onClick={() => onGovern("scope/reduce")}>收缩授权</button>
      <button type="button" className="secondary-button" disabled={busy || reasonMissing} onClick={() => onGovern("visibility/reduce")}>收缩可见性</button>
      <button type="button" className="ghost-button" disabled={busy || reasonMissing} onClick={() => onGovern("archive")}>归档</button>
      <button type="button" className="secondary-button" disabled={busy || reasonMissing || !ownershipTransferReady} onClick={() => onGovern("ownership-transfer")}>转移维护/部门</button>
    </div>
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

function AuditPage({ setPage, preset }: { setPage: (page: PageKey) => void; preset: AuditQueryPreset | null }) {
  const [query, setQuery] = useState<AuditQueryState>({ action: "", result: "", objectType: "", objectId: "" });
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<ViewError | null>(null);
  useEffect(() => {
    if (!preset) {
      return;
    }
    setQuery((current) => ({
      ...current,
      action: preset.action ?? current.action,
      result: preset.result ?? current.result,
      objectType: preset.objectType ?? current.objectType,
      objectId: preset.objectId ?? current.objectId
    }));
    setSelected(null);
    setRefreshKey((value) => value + 1);
  }, [preset]);
  const resource = useResource(
    () => adminApi.audit.list({ ...query, pageSize: 20 }),
    [query.action, query.result, query.objectType, query.objectId, refreshKey]
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
            <input className="compact-input" placeholder="对象 ID" value={query.objectId} onChange={(event) => setQuery({ ...query, objectId: event.target.value })} />
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

export function InlineError({ error }: { error: ViewError }) {
  return (
    <div className="inline-error" role="alert">
      <strong>{error.message}</strong>
      {error.code ? <span>错误码：{error.code}</span> : null}
      {error.requestId ? <span>Request ID：{error.requestId}</span> : null}
      {error.code === "internal_error" ? (
        <span className="probe-hint">
          状态核验：请用扩展详情或审核详情重新确认最终发布状态；保留 Request ID 给后端定位。
        </span>
      ) : null}
      <ErrorDetails value={error.details} />
    </div>
  );
}

function ErrorDetails({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const fields = [
    field("interface", read(record, "interfaceName", "path")),
    field("resourceId", read(record, "resourceId", "submissionId", "extensionId")),
    field("nextStep", read(record, "nextStep")),
    field("requestId", read(record, "requestId"))
  ].filter((item) => hasDisplayValue(item.value));
  if (fields.length === 0) {
    return null;
  }
  return (
    <dl className="error-detail-list">
      {fields.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{safeString(item.value)}</dd>
        </div>
      ))}
    </dl>
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

function selectLabel(option: string): string {
  if (option === "submitted_desc") return "提交时间：最新优先";
  if (option === "submitted_asc") return "提交时间：最早优先";
  return option || "全部";
}

function extensionMetricSummary(row: ApiRecord): string {
  const metrics = asRecord(read(row, "metrics"));
  if (!metrics) {
    return `${safeString(read(row, "starCount")) || "0"} Star`;
  }
  const pieces = [
    `${safeString(read(metrics, "stars")) || "0"} Star`,
    `${safeString(read(metrics, "downloads")) || "0"} 下载`,
    `${safeString(read(metrics, "activeUsers")) || "0"} 活跃`
  ];
  const failures = safeString(read(metrics, "localEventFailures"));
  return failures && failures !== "0" ? [...pieces, `${failures} 异常`].join(" · ") : pieces.join(" · ");
}

function Select({ value, onChange, options, ariaLabel }: { value: string; onChange: (value: string) => void; options: string[]; ariaLabel?: string }) {
  return (
    <select value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option || "all"} value={option}>
          {selectLabel(option)}
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

function currentReviewRevision(detail: ApiRecord): ApiRecord | undefined {
  const revisions = asRecordArray(read(detail, "revisions"));
  const currentRevisionId = safeString(read(detail, "currentRevisionId", "effectiveRevisionId", "revisionId", "latestRevision.id", "revision.id"));
  const matchedRevision = currentRevisionId
    ? revisions.find((item) => safeString(read(item, "id", "revisionId")) === currentRevisionId)
    : undefined;
  return matchedRevision ?? asRecord(read(detail, "latestRevision", "revision", "currentRevision")) ?? revisions[0];
}

function currentReviewPrecheck(detail: ApiRecord, revision: ApiRecord | undefined): ApiRecord | undefined {
  const prechecks = asRecordArray(read(detail, "prechecks"));
  const revisionId = safeString(read(revision, "id", "revisionId"));
  const matchedPrecheck = revisionId
    ? prechecks.find((item) => safeString(read(item, "revisionId", "revision_id")) === revisionId)
    : undefined;
  return matchedPrecheck ?? asRecord(read(detail, "systemPrecheck", "latestPrecheck")) ?? prechecks[0];
}

function withPrecheckStatus(value: unknown, row: unknown, statusKeys: string[]): unknown {
  const unwrapped = unwrapEnvelope(value);
  const valueRecord = asRecord(unwrapped);
  const rowRecord = asRecord(row);
  const status = read(valueRecord, "status", "result", "overallStatus", "precheckStatus", "riskLevel") ?? read(rowRecord, ...statusKeys);
  const checkedAt = read(valueRecord, "checkedAt", "createdAt", "updatedAt") ?? read(rowRecord, "createdAt", "created_at");
  const modelVersion = read(valueRecord, "modelVersion", "ruleVersion", "version") ?? read(rowRecord, "aiModel", "ai_model", "aiPromptVersion", "ai_prompt_version");

  if (!valueRecord && !rowRecord && !hasDisplayValue(unwrapped)) {
    return undefined;
  }
  const normalized: ApiRecord = valueRecord ? { ...valueRecord } : {};
  if (status !== undefined) {
    normalized.status = status;
  }
  if (checkedAt !== undefined) {
    normalized.checkedAt = checkedAt;
  }
  if (modelVersion !== undefined) {
    normalized.modelVersion = modelVersion;
  }
  return Object.keys(normalized).length > 0 ? normalized : unwrapped;
}

function firstRecord(value: unknown): ApiRecord | undefined {
  return asRecordArray(value)[0];
}

function asRecordArray(value: unknown): ApiRecord[] {
  if (Array.isArray(value)) {
    return value.map((item) => asRecord(item)).filter((item): item is ApiRecord => !!item);
  }
  const items = read(unwrapEnvelope(value), "items", "data.items");
  if (Array.isArray(items)) {
    return items.map((item) => asRecord(item)).filter((item): item is ApiRecord => !!item);
  }
  return [];
}

function asRecord(value: unknown): ApiRecord | undefined {
  const unwrapped = unwrapEnvelope(value);
  return unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped) ? unwrapped as ApiRecord : undefined;
}

function unwrapEnvelope(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    const record = current && typeof current === "object" && !Array.isArray(current) ? current as ApiRecord : undefined;
    if (!record || !("data" in record) || (!("type" in record) && !("schemaVersion" in record) && Object.keys(record).length > 2)) {
      return current;
    }
    current = record.data;
  }
  return current;
}

function mergeRecords(...values: unknown[]): ApiRecord | undefined {
  const merged: ApiRecord = {};
  for (const value of values) {
    const record = asRecord(value);
    if (record && hasDisplayValue(record)) {
      Object.assign(merged, record);
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

type DetailField = { label: string; value: unknown };

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function FieldGrid({ fields }: { fields: DetailField[] }) {
  const visibleFields = fields.filter((item) => hasDisplayValue(item.value));
  if (visibleFields.length === 0) {
    return <p className="section-empty">暂无数据</p>;
  }
  return (
    <dl className="field-grid">
      {visibleFields.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{safeString(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function JsonOrEmpty({ value }: { value: unknown }) {
  return hasDisplayValue(value) ? <JsonPreview value={value} /> : <p className="section-empty">暂无数据</p>;
}

function PackageSnapshotSummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (!record) {
    return <p className="section-empty">暂无包摘要</p>;
  }
  const precheck = asRecord(read(record, "precheck"));
  const files = asRecordArray(read(record, "files", "items", "fileManifest", "manifestItems"));
  return (
    <div className="detail-stack compact">
      <FieldGrid
        fields={[
          field("packageId", read(record, "packageId", "id")),
          field("SHA-256", read(record, "sha256", "packageSha256")),
          field("文件数", read(record, "fileCount", "file_count") ?? read(precheck, "fileManifestSummary.previewableCount")),
          field("预检状态", read(precheck, "status")),
          field("风险等级", read(precheck, "riskSummary.riskLevel", "riskLevel")),
          field("文件清单接口", read(record, "filesUrl")),
          field("storagePath", read(record, "storagePath"))
        ]}
      />
      {files.length > 0 ? (
        <DataTable
          items={files.slice(0, 8)}
          columns={[
            { label: "路径", render: (row) => safeString(read(row, "path", "relativePath")) },
            { label: "大小", render: (row) => safeString(read(row, "size", "sizeBytes")) },
            { label: "类型", render: (row) => safeString(read(row, "type", "fileType")) }
          ]}
        />
      ) : (
        <FieldGrid
          fields={[
            field("可预览文件", read(precheck, "fileManifestSummary.previewableCount")),
            field("风险文件", read(precheck, "fileManifestSummary.riskFileCount")),
            field("要求结构", read(precheck, "requiredStructure"))
          ]}
        />
      )}
    </div>
  );
}

function HistorySummary({ value }: { value: unknown }) {
  const records = asRecordArray(value);
  if (records.length === 0) {
    return hasDisplayValue(value) ? <p>{safeString(value)}</p> : <p className="section-empty">暂无历史记录</p>;
  }
  return (
    <div className="record-list compact">
      {records.slice(0, 6).map((item, index) => (
        <div className="record-row" key={safeString(read(item, "id", "eventId", "revisionId")) || index}>
          <div>
            <strong>{safeString(read(item, "action", "status", "decision", "eventType")) || "记录"}</strong>
            <span>{safeString(read(item, "actor", "actorName", "comment", "reason", "summary")) || formatDate(read(item, "createdAt", "submittedAt"))}</span>
          </div>
          {read(item, "requestId") ? <span className="api-pill">{safeString(read(item, "requestId"))}</span> : null}
        </div>
      ))}
    </div>
  );
}

function AdvancedJsonDetails({ items }: { items: Array<[string, unknown]> }) {
  const visible = items.filter(([, value]) => hasDisplayValue(value));
  if (visible.length === 0) return null;
  return (
    <details className="advanced-json">
      <summary>高级/调试信息</summary>
      {visible.map(([title, value]) => <JsonPreview key={title} title={title} value={value} />)}
    </details>
  );
}

function SystemCheckResult({ value }: { value: unknown }) {
  if (!hasDisplayValue(value)) {
    return (
      <PrecheckUnavailable title="系统校验结果缺失" description="系统校验结果未随详情返回，审核前需要本地或服务端继续确认。" />
    );
  }
  return (
    <PrecheckResult
      value={value}
      fields={[
        field("状态", read(value, "status", "result", "overallStatus")),
        field("包安全校验", read(value, "packageSecurity", "packageSecurityStatus", "securityStatus")),
        field("类型特定校验", read(value, "typedValidation", "typeSpecificCheck", "typeSpecificStatus")),
        field("内容外显风险", read(value, "contentExposureRisk", "exposureRisk", "visibilityRisk")),
        field("校验时间", formatDate(read(value, "checkedAt", "createdAt", "updatedAt")))
      ]}
      failureValue={read(value, "failures", "failedItems", "errors", "blockingIssues")}
      warningValue={read(value, "warnings", "warningItems", "riskWarnings")}
    />
  );
}

function AiPrecheckResult({ value }: { value: unknown }) {
  if (!hasDisplayValue(value)) {
    return <PrecheckUnavailable title="AI 预审不可用" description="申请仍进入人工审核；管理员决定必须独立记录，不得只保存 AI 建议。" />;
  }
  if (isUnavailablePrecheck(value)) {
    return (
      <div className="precheck-result warning">
        <PrecheckUnavailable title="AI 预审不可用" description="申请仍进入人工审核；管理员决定必须独立记录，不得只保存 AI 建议。" />
        <JsonPreview title="完整结果" value={value} />
      </div>
    );
  }
  return (
    <PrecheckResult
      value={value}
      fields={[
        field("预审状态", read(value, "status", "result", "precheckStatus")),
        field("模型或规则版本", read(value, "modelVersion", "ruleVersion", "version")),
        field("风险摘要", read(value, "summary", "riskSummary")),
        field("疑似敏感信息摘要", read(value, "sensitiveInfoSummary", "sensitiveDataSummary")),
        field("建议重点检查", read(value, "suggestedChecks", "recommendations", "checkpoints")),
        field("预审时间", formatDate(read(value, "checkedAt", "createdAt", "updatedAt")))
      ]}
      failureValue={read(value, "failures", "failedItems", "errors", "blockingIssues")}
      warningValue={read(value, "warnings", "warningItems", "riskWarnings")}
    />
  );
}

function PrecheckResult({
  value,
  fields,
  failureValue,
  warningValue
}: {
  value: unknown;
  fields: DetailField[];
  failureValue: unknown;
  warningValue: unknown;
}) {
  return (
    <div className={`precheck-result ${precheckTone(value, failureValue, warningValue)}`}>
      <FieldGrid fields={fields} />
      {hasDisplayValue(failureValue) ? <PrecheckCallout tone="danger" title="失败项" value={failureValue} /> : null}
      {hasDisplayValue(warningValue) ? <PrecheckCallout tone="warning" title="警告项" value={warningValue} /> : null}
      <JsonPreview title="完整结果" value={value} />
    </div>
  );
}

function PrecheckUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <div className="precheck-unavailable">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function PrecheckCallout({ tone, title, value }: { tone: "danger" | "warning"; title: string; value: unknown }) {
  return (
    <div className={`precheck-callout ${tone}`}>
      <strong>{title}</strong>
      <JsonPreview value={value} />
    </div>
  );
}

function TypedContentPreview({ detail, extensionType, value }: { detail: ApiRecord; extensionType: string; value: unknown }) {
  const source = mergeRecords(
    read(value, "precheck.definition"),
    read(value, "typePayload", "definition", "manifest", "packageMetadata"),
    value
  ) ?? value;
  if (extensionType === "MCP_SERVER") {
    return (
      <TypedContentBlock
        value={source}
        fields={[
          field("MCP 定义清单", read(source, "definitionList", "definitions", "mcpDefinition", "servers")),
          field("接入方式", read(source, "accessMode", "accessMethod", "connectionMode")),
          field("transport", read(source, "transport")),
          field("accessType", read(source, "accessType")),
          field("command 或 endpoint", read(source, "command", "endpoint", "endpointTemplate", "url", "serverUrl")),
          field("配置模板", read(source, "configTemplate", "configurationTemplate")),
          field("变量 schema", read(source, "variableSchema", "variablesSchema", "schema")),
          field("敏感变量", read(source, "sensitiveVariables", "secretVariables")),
          field("支持工具", read(source, "tools", "supportedTools")),
          field("连接检测", read(source, "connectionCheck", "connectionTest", "healthCheck")),
          field("权限声明", read(source, "permissions", "permissionDeclaration")),
          field("数据访问说明", read(source, "dataAccess", "dataAccessDescription")),
          field("端点/命令风险", read(detail, "endpointRiskSummary", "commandRiskSummary", "aiPrecheck.endpointRisks", "precheck.commandRisks")),
          field("local-command 风险", read(source, "localCommandRisk", "commandRisk", "executionRisk"))
        ]}
      />
    );
  }
  if (extensionType === "PLUGIN") {
    return (
      <TypedContentBlock
        value={source}
        fields={[
          field("插件包文件清单", read(source, "fileList", "packageFiles", "files")),
          field("安装模式", read(source, "installMode", "installationMode")),
          field("安装清单", read(source, "installManifest", "manifest")),
          field("安装、更新、卸载步骤", read(source, "lifecycleSteps", "installSteps", "updateSteps", "uninstallSteps", "manualInstallDoc", "manualUninstallDoc")),
          field("安装说明", read(source, "manualInstallDoc")),
          field("卸载说明", read(source, "manualUninstallDoc")),
          field("外部下载", read(source, "externalDownload")),
          field("支持回滚", read(source, "rollbackSupported", "supportsRollback")),
          field("目标工具", read(source, "targetTool", "targetTools")),
          field("兼容版本", read(source, "compatibleVersions", "compatibility")),
          field("权限声明", read(source, "permissions", "permissionDeclaration")),
          field("风险说明", read(source, "riskNotes", "riskStatement")),
          field("受控文件摘要", read(source, "downloadSummary", "controlledFileSummary")),
          field("安装路径/脚本风险", read(detail, "installPathRiskSummary", "scriptRiskSummary", "aiPrecheck.installationRisks", "precheck.installationRisks"))
        ]}
      />
    );
  }
  if (extensionType === "SKILL") {
    return (
      <TypedContentBlock
        value={source}
        fields={[
          field("文件清单", read(source, "fileList", "files")),
          field("SKILL.md 预览", read(source, "skillMarkdownPreview", "skillMdPreview", "skillMd")),
          field("README.md 预览", read(source, "readmePreview", "readme")),
          field("包 Hash", read(source, "packageHash", "sha256")),
          field("风险文件摘要", read(source, "riskFileSummary", "riskyFiles"))
        ]}
      />
    );
  }
  return <JsonOrEmpty value={source} />;
}

function TypedContentBlock({ fields, value }: { fields: DetailField[]; value: unknown }) {
  return (
    <div className="typed-content">
      <FieldGrid fields={fields} />
      <JsonOrEmpty value={value} />
    </div>
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

function field(label: string, value: unknown): DetailField {
  return { label, value };
}

function hasDisplayValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function reviewActionRequiresReason(action: ReviewAction): boolean {
  return action === "request-changes" || action === "reject";
}

function governanceActionRequiresReason(action: GovernanceAction): boolean {
  return action === "delist"
    || action === "relist"
    || action === "scope/reduce"
    || action === "visibility/reduce"
    || action === "archive"
    || action === "ownership-transfer";
}

export function buildExtensionGovernancePayload(
  action: GovernanceAction,
  input: {
    reason: string;
    targetVisibilityMode: string;
    targetScopeJson: string;
    targetMaintainerId: string;
    targetOwnerDepartmentId: string;
    securityReason: string;
    impactSummary: string;
    handlingAdvice: string;
  }
): ApiRecord {
  const normalizedReason = input.reason.trim();
  const payload: ApiRecord = {
    reasonType: action
  };
  if (action === "security-delist") {
    const securityReason = input.securityReason.trim();
    const impactSummary = input.impactSummary.trim();
    const handlingAdvice = input.handlingAdvice.trim();
    if (!securityReason || !impactSummary || !handlingAdvice) {
      throw new Error("安全下架必须填写安全原因、影响范围和处置建议。");
    }
    payload.securityReason = securityReason;
    payload.impactSummary = impactSummary;
    payload.handlingAdvice = handlingAdvice;
  } else {
    payload.reason = normalizedReason;
    payload.reasonDetail = normalizedReason;
  }
  if (action === "visibility/reduce") {
    payload.targetVisibilityMode = input.targetVisibilityMode;
  }
  if (action === "scope/reduce") {
    payload.targetScope = normalizeGovernanceTargetScope(JSON.parse(input.targetScopeJson));
  }
  if (action === "ownership-transfer") {
    const targetMaintainerId = input.targetMaintainerId.trim();
    const targetOwnerDepartmentId = input.targetOwnerDepartmentId.trim();
    if (!targetMaintainerId && !targetOwnerDepartmentId) {
      throw new Error("转移维护人或归属部门至少填写一个目标 ID。");
    }
    if (targetMaintainerId) {
      payload.targetMaintainerId = targetMaintainerId;
    }
    if (targetOwnerDepartmentId) {
      payload.targetOwnerDepartmentId = targetOwnerDepartmentId;
    }
  }
  return payload;
}

export function normalizeGovernanceTargetScope(value: unknown): ApiRecord {
  const scope = asRecord(value);
  if (!scope) {
    throw new Error("目标授权范围 JSON 必须是对象。");
  }
  const scopeType = safeString(read(scope, "scopeType")).trim();
  if (!scopeType) {
    throw new Error("目标授权范围必须包含 scopeType。");
  }
  const rawDepartments = Array.isArray(scope.departments) ? scope.departments : scope.departmentIds;
  if (!Array.isArray(rawDepartments)) {
    throw new Error("目标授权范围必须包含 departments。");
  }
  const departments = rawDepartments
    .map((item) => normalizeGovernanceDepartment(item))
    .filter((department): department is ApiRecord => !!department);
  if (departments.length === 0) {
    throw new Error("目标授权范围必须至少包含一个部门。");
  }
  const normalizedScope: ApiRecord = {
    ...scope,
    scopeType,
    departments
  };
  delete normalizedScope.departmentIds;
  return normalizedScope;
}

function normalizeGovernanceDepartment(value: unknown): ApiRecord | null {
  if (typeof value === "string") {
    const departmentId = value.trim();
    return departmentId ? { departmentId, includeChildren: false } : null;
  }
  const department = asRecord(value);
  if (!department) {
    return null;
  }
  const departmentId = safeString(read(department, "departmentId", "id")).trim();
  if (!departmentId) {
    return null;
  }
  return {
    ...department,
    departmentId,
    includeChildren:
      read(department, "includeChildren") === true ||
      safeString(read(department, "includeChildren")).toLowerCase() === "true"
  };
}

function precheckTone(value: unknown, failureValue: unknown, warningValue: unknown): "danger" | "warning" | "success" | "neutral" {
  const status = safeString(read(value, "status", "result", "overallStatus", "precheckStatus", "riskLevel")).toLowerCase();
  if (hasDisplayValue(failureValue) || status.includes("fail") || status.includes("error") || status.includes("失败") || status.includes("high")) {
    return "danger";
  }
  if (hasDisplayValue(warningValue) || status.includes("warn") || status.includes("警告") || status.includes("medium")) {
    return "warning";
  }
  if (status.includes("pass") || status.includes("success") || status.includes("通过") || status.includes("low")) {
    return "success";
  }
  return "neutral";
}

function isUnavailablePrecheck(value: unknown): boolean {
  const status = safeString(read(value, "status", "result", "precheckStatus")).toLowerCase();
  return status.includes("unavailable") || status.includes("不可用");
}

function reviewTypeLabel(value: string): string {
  if (value === "MCP_SERVER") {
    return "MCP 服务";
  }
  if (value === "PLUGIN") {
    return "Plugin";
  }
  if (value === "SKILL") {
    return "Skill";
  }
  return "扩展";
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

function copyText(value: string): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  void navigator.clipboard.writeText(value);
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
      requestId: error.requestId,
      details: error.details
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
