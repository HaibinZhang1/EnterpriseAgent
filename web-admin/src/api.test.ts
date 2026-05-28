import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, request } from "./api";

describe("admin API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves readable server errors and requestId", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      requestId: "req-test-1",
      success: false,
      data: null,
      error: {
        code: "VALIDATION_FAILED",
        message: "参数不完整",
        retryable: false
      }
    })));

    await expect(request("/admin/extensions")).rejects.toMatchObject({
      message: "参数不完整",
      code: "VALIDATION_FAILED",
      requestId: "req-test-1"
    });
  });

  it("throws a friendly error when the response is not the API envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("plain text", { status: 200 })));

    await expect(request("/admin/extensions")).rejects.toBeInstanceOf(AdminApiError);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
