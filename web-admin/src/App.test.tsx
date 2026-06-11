import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, {
  ExtensionDetailSections,
  ExtensionGovernanceButtons,
  InlineError,
  LoginScreen,
  PageRouter,
  ReviewDecisionButtons,
  ReviewDetailSections,
  buildExtensionGovernancePayload
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
          prechecks: [{ id: "precheck-1", status: "PASS" }],
          reviewHistory: [{ action: "SUBMITTED", actor: "Alice" }]
        }}
      />
    );

    for (const label of [
      "顶部摘要",
      "本次申请内容",
      "系统校验结果",
      "AI 系统预审结果",
      "包摘要与文件清单",
      "MCP 服务内容预览",
      "授权、可见选项与影响范围",
      "风险声明",
      "历史记录与审核意见",
      "高级/调试信息"
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

  it("renders package precheck definitions from service-shaped snapshots", () => {
    const mcpHtml = renderToStaticMarkup(
      <ReviewDetailSections
        detail={{
          submissionId: "sub-package-mcp",
          extensionType: "MCP_SERVER",
          currentRevisionId: "rev-package",
          revisions: [
            {
              id: "rev-package",
              payloadSnapshot: {
                type: "submission",
                data: {
                  type: "UPDATE",
                  extensionType: "MCP_SERVER",
                  metadata: { name: "包预审 MCP" }
                }
              },
              packageSnapshot: {
                type: "submission",
                data: {
                  extensionType: "MCP_SERVER",
                  sha256: "sha256:abc",
                  fileCount: 4,
                  precheck: {
                    status: "PASSED",
                    requiredStructure: "SKILL.md must be present at the zip root",
                    fileManifestSummary: {
                      previewableCount: 2,
                      riskFileCount: 0
                    },
                    definition: {
                      accessType: "TEAM",
                      transport: "http",
                      endpointTemplate: "https://mcp.example/api/{tenant}",
                      variablesSchema: { token: "secret" },
                      connectionTest: { method: "GET", path: "/health" },
                      permissions: ["documents:read"],
                      riskStatement: "外部端点需要人工确认"
                    }
                  }
                }
              }
            }
          ]
        }}
      />
    );

    expect(mcpHtml).toContain("包预审 MCP");
    expect(mcpHtml).toContain("包摘要与文件清单");
    expect(mcpHtml).toContain("sha256:abc");
    expect(mcpHtml).toContain("SKILL.md must be present at the zip root");
    expect(mcpHtml).toContain("https://mcp.example/api/{tenant}");
    expect(mcpHtml).toContain("/health");
    expect(mcpHtml).toContain("documents:read");
    expect(mcpHtml).toContain("外部端点需要人工确认");

    const pluginHtml = renderToStaticMarkup(
      <ExtensionDetailSections
        detail={{
          extensionId: "ext-package-plugin",
          name: "包预审插件",
          type: "PLUGIN",
          status: "PUBLISHED"
        }}
        versions={[
          {
            version: "4.0.0",
            packageSnapshot: {
              type: "submission",
              data: {
                extensionType: "PLUGIN",
                sha256: "sha256:def",
                precheck: {
                  status: "PASSED",
                  definition: {
                    installMode: "managed",
                    targetTools: ["JetBrains"],
                    manualInstallDoc: "按管理员策略安装",
                    manualUninstallDoc: "使用控制台卸载",
                    externalDownload: "https://downloads.example/plugin.zip",
                    manifest: { files: ["plugin.jar"] }
                  }
                }
              }
            }
          }
        ]}
      />
    );

    expect(pluginHtml).toContain("包预审插件");
    expect(pluginHtml).toContain("managed");
    expect(pluginHtml).toContain("JetBrains");
    expect(pluginHtml).toContain("按管理员策略安装");
    expect(pluginHtml).toContain("使用控制台卸载");
    expect(pluginHtml).toContain("https://downloads.example/plugin.zip");
    expect(pluginHtml).toContain("plugin.jar");
  });

  it("renders internal error status-probe details without hiding request anchors", () => {
    const html = renderToStaticMarkup(
      <InlineError
        error={{
          message: "服务内部错误",
          code: "internal_error",
          requestId: "req_probe_1",
          details: {
            interfaceName: "GET /api/reviews/tasks/sub-1",
            resourceId: "sub-1",
            nextStep: "Use review or extension detail endpoints to confirm final publication state."
          }
        }}
      />
    );

    expect(html).toContain("状态核验");
    expect(html).toContain("GET /api/reviews/tasks/sub-1");
    expect(html).toContain("sub-1");
    expect(html).toContain("req_probe_1");
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
          maintainer: { id: "user-2", name: "李四" },
          ownerDepartment: { id: "dept-2", name: "平台部", status: "ACTIVE" },
          visibilityMode: "AUTHORIZED_ONLY",
          scope: { departmentIds: ["dept-1"] },
          reviewStatus: "APPROVED",
          aiPrecheckStatus: "PASS",
          metrics: {
            stars: 7,
            downloads: 10,
            weeklyDownloads: 3,
            mcpUsageUsers: 0,
            pluginInstallUsers: 8,
            localEventFailures: 1,
            activeUsers: 6
          },
          riskLevel: "LOW",
          manifest: { commands: ["sync"] },
          localEvents: [{ type: "DEVICE_EXCEPTION", count: 1 }],
          reviewHistory: [{ status: "APPROVED", submitterName: "Alice" }],
          aiPrecheckHistory: [{ aiStatus: "PASSED", aiResultSummary: { summary: "低风险" } }],
          audit: { objectType: "extension", objectId: "ext-pk-1", actions: ["extension.ownership.transfer"] },
          recentAudits: [{ action: "extension.ownership.transfer", requestId: "req-transfer" }],
          ownershipHistory: [{ afterMaintainerName: "李四", reason: "职责移交" }]
        }}
      />
    );

    for (const label of [
      "基础信息",
      "维护人与归属部门",
      "授权与可见范围",
      "发布与审核状态",
      "使用统计与风险",
      "Plugin内容详情",
      "审核与 AI 预审历史",
      "审计入口与最近审计",
      "本地事件与异常",
      "维护/归属转移历史"
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("GitHub 同步插件");
    expect(html).toContain("Platform Team");
    expect(html).toContain("李四");
    expect(html).toContain("7");
    expect(html).toContain("extension.ownership.transfer");
    expect(html).toContain("req-transfer");
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

    const securityMissing = renderToStaticMarkup(
      <ExtensionGovernanceButtons reason="安全处置" securityDelistReady={false} onGovern={() => undefined} />
    );
    expect(disabledCount(securityMissing)).toBe(1);

    const governanceBusy = renderToStaticMarkup(
      <ExtensionGovernanceButtons reason="维护下架" busyAction="scope/reduce" onGovern={() => undefined} />
    );
    expect(disabledCount(governanceBusy)).toBe(7);

    const transferMissingTarget = renderToStaticMarkup(
      <ExtensionGovernanceButtons reason="职责调整" ownershipTransferReady={false} onGovern={() => undefined} />
    );
    expect(disabledCount(transferMissingTarget)).toBe(1);
  });

  it("builds server-shaped governance request payloads", () => {
    const scopePayload = buildExtensionGovernancePayload("scope/reduce", {
      reason: "department only",
      targetVisibilityMode: "AUTHORIZED_ONLY",
      targetScopeJson: JSON.stringify({
        scopeType: "DEPARTMENT",
        departmentIds: ["dept-1"]
      }),
      targetMaintainerId: "",
      targetOwnerDepartmentId: "",
      securityReason: "",
      impactSummary: "",
      handlingAdvice: ""
    });

    expect(scopePayload).toMatchObject({
      reason: "department only",
      reasonType: "scope/reduce",
      targetScope: {
        scopeType: "DEPARTMENT",
        departments: [
          {
            departmentId: "dept-1",
            includeChildren: false
          }
        ]
      }
    });
    expect((scopePayload.targetScope as Record<string, unknown>).departmentIds).toBeUndefined();

    const securityPayload = buildExtensionGovernancePayload("security-delist", {
      reason: "紧急处置",
      targetVisibilityMode: "AUTHORIZED_ONLY",
      targetScopeJson: "{}",
      targetMaintainerId: "",
      targetOwnerDepartmentId: "",
      securityReason: "疑似泄露敏感配置",
      impactSummary: "12 个用户已接入",
      handlingAdvice: "建议卸载或等待修复版本"
    });

    expect(securityPayload).toMatchObject({
      reasonType: "security-delist",
      securityReason: "疑似泄露敏感配置",
      impactSummary: "12 个用户已接入",
      handlingAdvice: "建议卸载或等待修复版本"
    });
    expect(securityPayload.reason).toBeUndefined();
    expect(securityPayload.reasonDetail).toBeUndefined();

    expect(() => buildExtensionGovernancePayload("security-delist", {
      reason: "紧急处置",
      targetVisibilityMode: "AUTHORIZED_ONLY",
      targetScopeJson: "{}",
      targetMaintainerId: "",
      targetOwnerDepartmentId: "",
      securityReason: "疑似泄露敏感配置",
      impactSummary: "",
      handlingAdvice: "建议卸载"
    })).toThrow("安全下架必须填写安全原因、影响范围和处置建议。");

    const transferPayload = buildExtensionGovernancePayload("ownership-transfer", {
      reason: "职责移交",
      targetVisibilityMode: "AUTHORIZED_ONLY",
      targetScopeJson: "{}",
      targetMaintainerId: "user-2",
      targetOwnerDepartmentId: "dept-2",
      securityReason: "",
      impactSummary: "",
      handlingAdvice: ""
    });

    expect(transferPayload).toMatchObject({
      reason: "职责移交",
      reasonType: "ownership-transfer",
      reasonDetail: "职责移交",
      targetMaintainerId: "user-2",
      targetOwnerDepartmentId: "dept-2"
    });

    expect(() => buildExtensionGovernancePayload("ownership-transfer", {
      reason: "职责移交",
      targetVisibilityMode: "AUTHORIZED_ONLY",
      targetScopeJson: "{}",
      targetMaintainerId: "",
      targetOwnerDepartmentId: "",
      securityReason: "",
      impactSummary: "",
      handlingAdvice: ""
    })).toThrow("转移维护人或归属部门至少填写一个目标 ID。");
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
