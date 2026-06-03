import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, {
  ExtensionDetailSections,
  ExtensionGovernanceButtons,
  LoginScreen,
  PageRouter,
  ReviewDecisionButtons,
  ReviewDetailSections
} from "./App";
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
          systemChecks: { status: "WARNING", packageValid: true, signature: "VALID", warnings: ["存在外部端点"] },
          aiPrecheck: { status: "WARNING", riskLevel: "MEDIUM", summary: "需要人工确认外部 API 范围" },
          definition: {
            accessType: "TEAM",
            transport: "stdio",
            command: "node server.js",
            tools: ["syncDocuments"],
            variableSchema: { token: "secret" },
            localCommandRisk: "local-command 需要确认工作目录"
          },
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
    expect(html).toContain("stdio");
    expect(html).toContain("local-command");
    expect(html).toContain("42");
  });

  it("keeps unavailable AI precheck and failed system checks visible", () => {
    const html = renderToStaticMarkup(
      <ReviewDetailSections
        detail={{
          submissionId: "sub-2",
          extensionName: "安装包治理",
          extensionType: "PLUGIN",
          systemChecks: {
            status: "FAILURE",
            failures: ["包安全校验存在风险"]
          },
          definition: {
            installMode: "managed",
            installManifest: { files: ["plugin.exe"] },
            rollbackSupported: true,
            targetTool: "VS Code",
            compatibleVersions: ["1.90+"],
            permissions: ["file-system"],
            installationRisks: ["安装路径需要管理员确认"]
          }
        }}
      />
    );

    expect(html).toContain("AI 预审不可用");
    expect(html).toContain("申请仍进入人工审核");
    expect(html).toContain("失败项");
    expect(html).toContain("包安全校验存在风险");
    expect(html).toContain("安装模式");
    expect(html).toContain("managed");
    expect(html).toContain("支持回滚");
    expect(html).toContain("VS Code");
  });

  it("keeps explicit unavailable AI precheck status visible with returned details", () => {
    const html = renderToStaticMarkup(
      <ReviewDetailSections
        detail={{
          submissionId: "sub-3",
          extensionName: "外部端点接入",
          extensionType: "MCP_SERVER",
          systemChecks: { status: "PASS" },
          aiPrecheck: {
            status: "UNAVAILABLE",
            summary: "AI service timeout",
            checkedAt: "2026-06-03T09:00:00Z"
          },
          definition: {
            accessType: "TEAM",
            transport: "http",
            endpoint: "https://internal.example/api"
          }
        }}
      />
    );

    expect(html).toContain("AI 预审不可用");
    expect(html).toContain("AI service timeout");
    expect(html).toContain("https://internal.example/api");
  });

  it("renders server-shaped revision snapshots and precheck rows", () => {
    const html = renderToStaticMarkup(
      <ReviewDetailSections
        detail={{
          submissionId: "sub-server",
          extensionType: "MCP_SERVER",
          currentRevisionId: "rev-1",
          revisions: [
            {
              id: "rev-1",
              payloadSnapshot: {
                type: "submission",
                data: {
                  type: "UPDATE",
                  extensionType: "MCP_SERVER",
                  extensionId: "ext-server",
                  version: "2.1.0",
                  metadata: { name: "服务端同步" },
                  authorizationScope: { departmentIds: ["dept-1"] },
                  visibilityMode: "AUTHORIZED_ONLY",
                  riskStatement: { summary: "读取内部索引" },
                  typePayload: {
                    accessType: "TEAM",
                    transport: "stdio",
                    command: "node mcp.js",
                    variablesSchema: { token: "secret" },
                    connectionCheck: { type: "startup" },
                    tools: ["syncDocuments"],
                    localCommandRisk: "需要固定工作目录"
                  }
                }
              }
            }
          ],
          prechecks: [
            {
              revision_id: "rev-1",
              rule_status: "FAILURE",
              ruleResult: {
                type: "precheck",
                data: {
                  status: "FAILURE",
                  failures: ["transport 不合法"],
                  warnings: ["local-command 风险"]
                }
              },
              ai_status: "UNAVAILABLE",
              aiResultSummary: {
                type: "ai-precheck",
                data: {
                  status: "UNAVAILABLE",
                  summary: "AI service timeout"
                }
              }
            }
          ]
        }}
      />
    );

    expect(html).toContain("服务端同步");
    expect(html).toContain("transport 不合法");
    expect(html).toContain("AI 预审不可用");
    expect(html).toContain("AI service timeout");
    expect(html).toContain("mcp.js");
    expect(html).toContain("token");
    expect(html).toContain("startup");
    expect(html).toContain("需要固定工作目录");
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

  it("uses extension version snapshots for typed governance content", () => {
    const html = renderToStaticMarkup(
      <ExtensionDetailSections
        detail={{
          extensionId: "ext-2",
          name: "受控安装插件",
          type: "PLUGIN",
          status: "PUBLISHED",
          currentVersion: "3.0.0"
        }}
        versions={[
          {
            version: "3.0.0",
            payloadSnapshot: {
              type: "extension-version",
              data: {
                extensionType: "PLUGIN",
                typePayload: {
                  installMode: "managed",
                  installManifest: { files: ["plugin.exe"] },
                  rollbackSupported: true,
                  targetTools: ["VS Code"],
                  permissions: ["file-system"]
                }
              }
            },
            packageSnapshot: {
              type: "package",
              data: {
                downloadSummary: "sha256:abc"
              }
            }
          }
        ]}
      />
    );

    expect(html).toContain("受控安装插件");
    expect(html).toContain("managed");
    expect(html).toContain("plugin.exe");
    expect(html).toContain("支持回滚");
    expect(html).toContain("VS Code");
    expect(html).toContain("file-system");
    expect(html).toContain("sha256:abc");
  });

  it("disables reason-required review and governance actions until a reason is present", () => {
    const reviewWithoutReason = renderToStaticMarkup(
      <ReviewDecisionButtons busyAction={null} comment="" onDecide={() => undefined} />
    );
    expect(disabledCount(reviewWithoutReason)).toBe(2);

    const reviewWithReason = renderToStaticMarkup(
      <ReviewDecisionButtons busyAction={null} comment="需要补充风险说明" onDecide={() => undefined} />
    );
    expect(disabledCount(reviewWithReason)).toBe(0);

    const governanceWithoutReason = renderToStaticMarkup(
      <ExtensionGovernanceButtons reason="" onGovern={() => undefined} />
    );
    expect(disabledCount(governanceWithoutReason)).toBe(6);

    const governanceWithReason = renderToStaticMarkup(
      <ExtensionGovernanceButtons reason="维护下架" onGovern={() => undefined} />
    );
    expect(disabledCount(governanceWithReason)).toBe(0);
  });
});

function disabledCount(html: string): number {
  return (html.match(/disabled=\"\"/g) ?? []).length;
}

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
