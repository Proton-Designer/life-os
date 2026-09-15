import { describe, expect, it } from "vitest";
import { operationToResponse, extractToken, CORS_HEADERS } from "../http";
import { GENERIC_TOOL_ERROR_MESSAGE, OPERATION_ERROR_STATUS, type OperationResult, type OperationErrorCode } from "@/lib/agent-api/execute";

/**
 * P4-17: executeOperation's typed result → HTTP. Red first (module missing).
 * Includes the P4-02 review AC: a tool result with isError:true that did NOT
 * throw must never be a 200.
 */

const ctx = { requestId: "req-1", operation: "deen.prayer.read", linkBase: null };

function success(toolResult: { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }): OperationResult {
  const text = toolResult.content.map((c) => c.text).join("\n");
  return { ok: true, data: toolResult.structuredContent ?? null, text, summary: "s", toolResult };
}

describe("operationToResponse", () => {
  it("a success body is structuredContent verbatim; meta travels in headers only", async () => {
    const res = operationToResponse(success({ content: [{ type: "text", text: "{}" }], structuredContent: { items: [1], has_more: false, cursor: null } }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [1], has_more: false, cursor: null });
    expect(res.headers.get("x-request-id")).toBe("req-1");
    expect(res.headers.get("x-lifeos-operation")).toBe("deen.prayer.read");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a success without structuredContent returns {text}", async () => {
    const res = operationToResponse(success({ content: [{ type: "text", text: "done" }] }), ctx);
    expect(await res.json()).toEqual({ text: "done" });
  });

  it("isError:true with caller-facing text → 400 invalid_input carrying that text", async () => {
    const res = operationToResponse(success({ content: [{ type: "text", text: "patch.kind must be one of: a, b" }], isError: true }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "invalid_input", status: 400, detail: "patch.kind must be one of: a, b", operation: "deen.prayer.read", request_id: "req-1" });
  });

  it("isError:true with empty or generic text → 500 internal, never 200", async () => {
    for (const text of ["", GENERIC_TOOL_ERROR_MESSAGE]) {
      const res = operationToResponse(success({ content: [{ type: "text", text }], structuredContent: { ignored: true }, isError: true }), ctx);
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe("internal");
    }
  });

  it("every executeOperation failure code maps to its status as problem+json; 429 adds Retry-After", async () => {
    for (const code of Object.keys(OPERATION_ERROR_STATUS) as OperationErrorCode[]) {
      const res = operationToResponse({ ok: false, code, status: OPERATION_ERROR_STATUS[code], message: `m-${code}` }, ctx);
      expect(res.status).toBe(OPERATION_ERROR_STATUS[code]);
      expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
      const body = await res.json();
      expect(body).toEqual({ type: `urn:lifeos:problem:${code}`, title: expect.any(String), status: OPERATION_ERROR_STATUS[code], code, detail: `m-${code}`, operation: "deen.prayer.read", request_id: "req-1" });
      expect(res.headers.get("retry-after")).toBe(code === "rate_limited" ? "60" : null);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("Link rel=next only for a list page that has more and a linkBase", () => {
    const page = success({ content: [{ type: "text", text: "" }], structuredContent: { items: [], has_more: true, cursor: "MjA" } });
    const withLink = operationToResponse(page, { ...ctx, linkBase: new URL("https://x.test/api/v1/deen/prayer?cursor=old&detail=ids") });
    expect(withLink.headers.get("link")).toBe('<https://x.test/api/v1/deen/prayer?cursor=MjA&detail=ids>; rel="next"');
    expect(operationToResponse(page, ctx).headers.has("link")).toBe(false);
    const last = success({ content: [{ type: "text", text: "" }], structuredContent: { items: [], has_more: false, cursor: null } });
    expect(operationToResponse(last, { ...ctx, linkBase: new URL("https://x.test/api/v1/deen/prayer") }).headers.has("link")).toBe(false);
  });
});

describe("extractToken", () => {
  it("reads Bearer (any scheme case) or X-LifeOS-Token, nothing else", () => {
    expect(extractToken(new Headers({ Authorization: "Bearer lifeos_pat_a" }))).toBe("lifeos_pat_a");
    expect(extractToken(new Headers({ Authorization: "bearer   lifeos_pat_a " }))).toBe("lifeos_pat_a");
    expect(extractToken(new Headers({ "X-LifeOS-Token": "lifeos_pat_b" }))).toBe("lifeos_pat_b");
    expect(extractToken(new Headers({ Authorization: "Basic abc" }))).toBeNull();
    expect(extractToken(new Headers({ Cookie: "lifeos_pat=lifeos_pat_c" }))).toBeNull();
    expect(extractToken(new Headers())).toBeNull();
  });
});

describe("CORS_HEADERS", () => {
  it("never allows credentials", () => {
    expect(Object.keys(CORS_HEADERS).map((k) => k.toLowerCase())).not.toContain("access-control-allow-credentials");
  });
});
