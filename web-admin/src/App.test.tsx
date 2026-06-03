import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { ExtensionDetailSections, LoginScreen, PageRouter, ReviewDetailSections } from "./App";
import { Role, UserSummary } from "./api";

const baseUser: UserSummary = {
  id: "user-1",
  name: "Admin",
  phoneMasked: "138****0000",
  role: "SYSTEM_ADMIN",
  departmentId: "dept-1",
  departmentName: "总部",
  status: "ACTIVE",
  mustChangePassword: false
};

describe("Web Admin renderer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the admin login before authentication", () => {
    const html = renderToStaticMarkup(<LoginScreen onLogin={() => undefined} />);
    expect(html).toContain("管理端登录");
    expect(html).toContain("服务端地址");
    expect(html).toContain("登录");
  });

  it("renders the shell and keeps system-only navigation hidden from department admins", () => {
    stubSession({ ...baseUser, role: "DEPARTMENT_ADMIN" });
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("概览");
    expect(html).toContain("审核");
    expect(html).toContain("部门与用户");
    expect(html).not.toContain("客户端更新");
    expect(html).not.toContain("系统设置");
  });

  it("shows all required admin areas for system admins", () => {
    stubSession({ ...baseUser, role: "SYSTEM_ADMIN" });
    const html = renderToStaticMarkup(<App />);
    for (const label of ["概览", "审核", "扩展管理", "部门与用户", "审计日志", "客户端设备", "客户端更新", "系统设置"]) {
      expect(html).toContain(label);
    }
  });

  it("renders required page shells without desktop management navigation", () => {
    const user = { ...baseUser, role: "SYSTEM_ADMIN" as Role };
    const pages = [
      ["reviews", "审核列表"],
      ["extensions", "扩展管理"],
      ["organization", "组织结构"],
      ["audit", "审计日志"],
      ["devices", "客户端设备"],
      ["updates", "客户端版本"],
      ["settings", "系统设置"]
    ] as const;
    for (const [page, label] of pages) {
      const html = renderToStaticMarkup(<PageRouter page={page} user={user} setPage={() => undefined} />);
      expect(html).toContain(label);
      expect(html).not.toContain("Agent");
      expect(html).not.toContain("社区");
      expect(html).not.toContain("本地");
    }
  });

  it("shows a no-permission state for system-only pages", () => {
    const html = renderToStaticMarkup(
      <PageRouter page="settings" user={{ ...baseUser, role: "DEPARTMENT_ADMIN" }} setPage={() => undefined} />
    );
    expect(html).toContain("无权访问");
    expect(html).toContain("仅系统管理员可见");
  });

  it("renders review detail sections required by the admin review flow", () => {
    const html = renderToStaticMarkup(
      <ReviewDetailSections
        detail={{
          submissionId: "sub-1",
          extensionId: "ext-1",
          extensionName: "知识库同步",
          extensionType: "MCP_SERVER",
          status: "PENDING",
          submitterName: "Alice",
          departmentName: "研发部",
          targetVersion: "1.2.0",
          submittedAt: "2026-06-03T08:00:00Z",
          applicationType: "UPDATE",
          changeSummary: "新增只读同步工具",
          systemChecks: { packageValid: true, signature: "VALID" },
          aiPrecheck: { riskLevel: "MEDIUM", summary: "需要人工确认外部 API 范围" },
          definition: { tools: ["syncDocuments"] },
          targetVisibilityMode: "AUTHORIZED_ONLY",
          impactUserCount: 42,
          riskStatement: "涉及内部文档索引",
          reviewHistory: [{ action: "SUBMITTED", actor: "Alice" }]
        }}
      />
    );

    for (const label of [
      "顶部摘要",
      "本次申请内容",
      "系统校验结果",
      "AI 系统预审结果",
      "MCP 服务内容预览",
      "授权、可见选项与影响范围",
      "风险声明",
      "历史记录与审核意见"
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("知识库同步");
    expect(html).toContain("syncDocuments");
    expect(html).toContain("42");
  });

  it("renders extension governance sections required by the admin extension flow", () => {
    const html = renderToStaticMarkup(
      <ExtensionDetailSections
        detail={{
          extensionId: "ext-1",
          name: "GitHub 同步插件",
          type: "PLUGIN",
          status: "PUBLISHED",
          version: "2.0.1",
          authorName: "Platform Team",
          ownerDepartmentName: "平台部",
          visibilityMode: "AUTHORIZED_ONLY",
          scope: { departmentIds: ["dept-1"] },
          reviewStatus: "APPROVED",
          aiPrecheckStatus: "PASS",
          installCount: 10,
          usageCount: 328,
          riskLevel: "LOW",
          manifest: { commands: ["sync"] },
          localEvents: [{ type: "DEVICE_EXCEPTION", count: 1 }]
        }}
      />
    );

    for (const label of [
      "基础信息",
      "授权与可见范围",
      "发布与审核状态",
      "使用统计与风险",
      "Plugin内容详情",
      "本地事件与异常"
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("GitHub 同步插件");
    expect(html).toContain("Platform Team");
    expect(html).toContain("DEVICE_EXCEPTION");
  });
});

function stubSession(user: UserSummary) {
  const storage = new Map<string, string>([
    ["eah.admin.token", "token-1"],
    ["eah.admin.user", JSON.stringify(user)]
  ]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    }
  });
}
