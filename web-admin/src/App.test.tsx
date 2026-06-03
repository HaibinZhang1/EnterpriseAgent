import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { LoginScreen, PageRouter } from "./App";
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
