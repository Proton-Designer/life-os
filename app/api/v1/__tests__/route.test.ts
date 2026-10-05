import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_MAX_CALLS, RATE_LIMIT_USER_MAX_CALLS } from "@/lib/mcp/rate-limit";
import { fakeServiceClient, fakeUserClient } from "./fake-db";
// P4-14: dynamically imported in beforeEach, not statically here -- see
// app/api/mcp/__tests__/route.test.ts's own comment on why (a static import
// here drags in the mocked @/lib/mcp/tokens before this file's own mock
// consts initialize, tripping their TDZ).

/**
 * P4-17: the /api/v1 REST adapter, driven through its EXPORTED route
 * handlers with real Request objects (no server, no network). Mocked: the
 * service-role client, verifyAccessToken, isUserActive and the session mint.
 * Everything between them runs for real: header auth, path grammar, schema
 * validation, executeOperation (scope, rate limit, audit) and the tools
 * themselves. Red first: written before app/api/v1 existed.
 */

type Verified = { userId: string; tokenId: string; scopes: ("read" | "write")[] } | null;
const verifyAccessTokenMock = vi.fn(async (_c: unknown, raw: string): Promise<Verified> => {
  if (!raw.startsWith("lifeos_pat_")) return null;
  return raw.includes("readonly") ? { userId: "user-1", tokenId: "tok-ro", scopes: ["read"] } : { userId: "user-1", tokenId: "tok-1", scopes: ["read", "write"] };
});
vi.mock("@/lib/mcp/tokens", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/tokens")>("@/lib/mcp/tokens");
  return { ...actual, verifyAccessToken: verifyAccessTokenMock };
});

const isUserActiveMock = vi.fn(async () => true);
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: isUserActiveMock }));

let userClientOpts: Parameters<typeof fakeUserClient>[0] = {};
vi.mock("@/lib/mcp/session", () => ({
  mintSessionJwt: vi.fn(async () => "fake.jwt"),
  buildUserScopedClient: vi.fn(() => fakeUserClient(userClientOpts)),
}));

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient }));

let service = fakeServiceClient();

beforeEach(async () => {
  service = fakeServiceClient();
  createServiceRoleClient.mockImplementation(() => service.client);
  verifyAccessTokenMock.mockClear();
  isUserActiveMock.mockReset();
  isUserActiveMock.mockResolvedValue(true);
  userClientOpts = {};
  const { __resetAuthFailureCacheForTests } = await import("@/lib/mcp/auth-failure-limit");
  __resetAuthFailureCacheForTests();
});

const BASE = "https://lifeos.test/api/v1";
const AUTH = { Authorization: "Bearer lifeos_pat_live" };

async function catchAll() {
  return import("../[...path]/route");
}

function req(pathAndQuery: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const hasBody = init.body !== undefined;
  return new Request(`${BASE}${pathAndQuery}`, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...init.headers },
    body: hasBody ? (typeof init.body === "string" ? init.body : JSON.stringify(init.body)) : undefined,
  });
}

async function problem(res: Response) {
  expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
  const body = await res.json();
  expect(body).toEqual(expect.objectContaining({ type: expect.any(String), title: expect.any(String), status: res.status, code: expect.any(String), request_id: expect.any(String) }));
  expect("detail" in body).toBe(true);
  expect("operation" in body).toBe(true);
  return body as { code: string; detail: string; operation: string | null; request_id: string };
}

describe("CORS preflight", () => {
  it("OPTIONS → 204 with ACAO *, the allowed headers and methods, and NEVER Allow-Credentials, on every route file", async () => {
    const files = [await import("../route"), await import("../me/route"), await import("../actions/route"), await catchAll()];
    for (const mod of files) {
      const res = await mod.OPTIONS();
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
      expect(res.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type, Idempotency-Key, X-LifeOS-Token");
      expect(res.headers.has("access-control-allow-credentials")).toBe(false);
      expect(await res.text()).toBe("");
    }
  });

  it("CORS headers are on real responses too (a 401 included), still without Allow-Credentials", async () => {
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer"));
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toMatch(/Link/);
    expect(res.headers.has("access-control-allow-credentials")).toBe(false);
  });
});

describe("auth", () => {
  it("no credentials → 401 problem+json with WWW-Authenticate, and no token lookup", async () => {
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await problem(res)).code).toBe("unauthenticated");
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it("IGNORES cookies: a request carrying only a Supabase session cookie is 401, and nothing is looked up", async () => {
    const { GET, POST } = await catchAll();
    const cookie = "sb-abc-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0; lifeos_pat=lifeos_pat_live";
    const get = await GET(req("/deen/prayer", { headers: { Cookie: cookie } }));
    const post = await POST(req("/deen/prayer/log", { headers: { Cookie: cookie }, body: { patch: {} } }));
    expect(get.status).toBe(401);
    expect(post.status).toBe(401);
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
    expect(service.auditInserts).toHaveLength(0);
  });

  it("the REST adapter never imports a cookie reader (structural guard: CORS * is only safe while auth is header-only)", () => {
    for (const file of ["lib/agent-api/rest/handler.ts", "lib/agent-api/rest/http.ts", "lib/agent-api/rest/parse-path.ts", "lib/agent-api/operations.ts"]) {
      const src = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(/next\/headers|cookies\(|lib\/supabase\/server|getAuthedUser|requireUser/);
    }
  });

  it("a wrong token, a non-Bearer scheme, and an inactive user are all the same 401", async () => {
    const { GET } = await catchAll();
    expect((await GET(req("/deen/prayer", { headers: { Authorization: "Bearer nope" } }))).status).toBe(401);
    expect((await GET(req("/deen/prayer", { headers: { Authorization: "Basic bGlmZW9zX3BhdF9saXZl" } }))).status).toBe(401);
    isUserActiveMock.mockResolvedValue(false);
    const inactive = await GET(req("/deen/prayer", { headers: AUTH }));
    expect(inactive.status).toBe(401);
    expect(isUserActiveMock).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("X-LifeOS-Token is accepted as the alternative header", async () => {
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer", { headers: { "X-LifeOS-Token": "lifeos_pat_live" } }));
    expect(res.status).toBe(200);
    expect(verifyAccessTokenMock).toHaveBeenCalledWith(expect.anything(), "lifeos_pat_live");
  });

  it("a token in the query string is refused with 400 even alongside a valid header, before any lookup", async () => {
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer?access_token=lifeos_pat_live", { headers: AUTH }));
    expect(res.status).toBe(400);
    expect((await problem(res)).code).toBe("token_in_query");
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it("P4-14: a 401 becomes 429 rate_limited with Retry-After once the auth-failure RPC reports over_limit, and a successful call never consumes that bucket", async () => {
    service = fakeServiceClient();
    service.client.rpc = vi.fn(async (name: string) =>
      name === "mcp_rate_limit_note_failure" ? { data: { over_limit: true, retry_after_seconds: 33 }, error: null } : { data: { allowed: true }, error: null },
    );
    createServiceRoleClient.mockImplementation(() => service.client);
    const { GET } = await catchAll();

    const flooded = await GET(req("/deen/prayer", { headers: { Authorization: "Bearer nope", "x-forwarded-for": "203.0.113.9" } }));
    expect(flooded.status).toBe(429);
    expect(flooded.headers.get("retry-after")).toBe("33");
    expect((await problem(flooded)).code).toBe("rate_limited");

    const ok = await GET(req("/deen/prayer", { headers: { ...AUTH, "x-forwarded-for": "203.0.113.9" } }));
    expect(ok.status).toBe(200);
    expect(service.client.rpc).toHaveBeenCalledTimes(2); // the flooded 401 (note_failure) + the ok call's rate-limit consume; never a note_failure for the success
    expect((service.client.rpc as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(["mcp_rate_limit_note_failure", "mcp_rate_limit_consume"]);
  });
});

describe("discovery", () => {
  it("GET /api/v1 needs no auth and links the live routes with absolute URLs", async () => {
    const { GET } = await import("../route");
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.links.me).toBe(`${BASE}/me`);
    expect(body.links.capabilities).toBe(`${BASE}/capabilities`);
    expect(body.links.actions).toBe(`${BASE}/actions`);
    expect(body.auth.query_string_tokens).toMatch(/rejected/i);
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it("GET /me returns token label, scopes, expiry, client kind and the shared rate limit, audited as transport rest", async () => {
    const { GET } = await import("../me/route");
    const res = await GET(req("/me", { headers: AUTH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toEqual(expect.objectContaining({ id: "tok-1", label: "Instinct", scopes: ["read", "write"], expires_at: "2026-12-01T00:00:00.000Z", client_kind: "agent", last4: "abcd" }));
    expect(body.rate_limit).toEqual({
      max_calls: RATE_LIMIT_MAX_CALLS,
      window_seconds: 60,
      scope: "per token, shared by MCP and REST",
      user_max_calls: RATE_LIMIT_USER_MAX_CALLS,
      user_scope: "across all of this account's tokens",
    });
    expect(service.auditInserts).toEqual([expect.objectContaining({ operation: "discovery.me", transport: "rest", outcome: "ok", token_id: "tok-1" })]);
  });
});

describe("reads", () => {
  it("a list read returns the tool's payload verbatim plus Link rel=next that keeps the other params", async () => {
    userClientOpts = { rowCount: 25 };
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer?detail=summary&filter[status]=active", { headers: AUTH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(20);
    expect(body.has_more).toBe(true);
    expect(typeof body.cursor).toBe("string");
    const link = res.headers.get("link") ?? "";
    const m = /^<([^>]+)>; rel="next"$/.exec(link);
    expect(m).not.toBeNull();
    const next = new URL(m![1]);
    expect(next.pathname).toBe("/api/v1/deen/prayer");
    expect(next.searchParams.get("cursor")).toBe(body.cursor);
    expect(next.searchParams.get("detail")).toBe("summary");
    expect(next.searchParams.get("filter[status]")).toBe("active");
    expect(res.headers.get("x-lifeos-operation")).toBe("deen.prayer.read");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(service.auditInserts).toEqual([expect.objectContaining({ tool_name: "read", operation: "deen.prayer.read", transport: "rest", outcome: "ok" })]);
  });

  it("the last page has no Link header", async () => {
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer", { headers: AUTH }));
    expect(res.status).toBe(200);
    expect(res.headers.has("link")).toBe(false);
  });

  it("an unknown entity is 400 carrying the tool's own 'Known entities' guidance", async () => {
    const { GET } = await catchAll();
    const res = await GET(req("/deen/nope", { headers: AUTH }));
    expect(res.status).toBe(400);
    const body = await problem(res);
    expect(body.code).toBe("invalid_input");
    expect(body.detail).toMatch(/Known entities: .*prayer/);
    expect(body.operation).toBe("deen.nope.read");
  });

  it("a by-id read of a missing row is 404 not_found", async () => {
    userClientOpts = { rowCount: 0 };
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer/missing", { headers: AUTH }));
    expect(res.status).toBe(404);
    expect((await problem(res)).code).toBe("not_found");
  });

  it("schema-invalid args are 400 before anything runs (same zod schema MCP uses)", async () => {
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer?detail=everything", { headers: AUTH }));
    expect(res.status).toBe(400);
    const body = await problem(res);
    expect(body.code).toBe("invalid_input");
    expect(body.detail).toMatch(/detail/);
    expect(service.auditInserts).toHaveLength(0);
  });
});

describe("writes, scope, rate limit, errors", () => {
  it("a read-only token's write is 403 insufficient_scope and audited denied with transport rest", async () => {
    const { POST } = await catchAll();
    const res = await POST(req("/deen/prayer/log", { headers: { Authorization: "Bearer lifeos_pat_readonly" }, body: { patch: { date: "2026-09-08", prayer_name: "fajr", status: "on_time" } } }));
    expect(res.status).toBe(403);
    const body = await problem(res);
    expect(body.code).toBe("insufficient_scope");
    expect(body.operation).toBe("deen.prayer.log");
    expect(service.auditInserts).toEqual([expect.objectContaining({ outcome: "denied", transport: "rest", token_id: "tok-ro" })]);
  });

  it("a rate-limited token gets 429 with Retry-After", async () => {
    service = fakeServiceClient({ preloadCounts: { "tok-1": RATE_LIMIT_MAX_CALLS } });
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer", { headers: AUTH }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await problem(res)).code).toBe("rate_limited");
  });

  it("an audit-write failure is 503 audit_failed", async () => {
    service = fakeServiceClient({ auditInsertError: true });
    const { GET } = await catchAll();
    const res = await GET(req("/deen/prayer", { headers: AUTH }));
    expect(res.status).toBe(503);
    expect((await problem(res)).code).toBe("audit_failed");
  });

  it("malformed JSON is 400 invalid_json; an unknown route 404; a wrong method 405 with Allow", async () => {
    const { GET, POST } = await catchAll();
    const badJson = await POST(req("/deen/prayer/log", { headers: AUTH, body: "{not json" }));
    expect(badJson.status).toBe(400);
    expect((await problem(badJson)).code).toBe("invalid_json");

    const missing = await GET(req("/deen", { headers: AUTH }));
    expect(missing.status).toBe(404);
    expect((await problem(missing)).code).toBe("route_not_found");

    const wrong = await POST(req("/deen/prayer", { headers: AUTH, body: {} }));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET, OPTIONS");
    expect((await problem(wrong)).code).toBe("method_not_allowed");
  });

  it("POST /actions {tool,args} returns exactly what the resource route returns", async () => {
    const { GET } = await catchAll();
    const { POST } = await import("../actions/route");
    const viaResource = await (await GET(req("/deen/prayer?detail=full", { headers: AUTH }))).json();
    const viaActions = await POST(req("/actions", { headers: AUTH, body: { tool: "read", args: { domain: "deen", entity: "prayer", detail: "full" } } }));
    expect(viaActions.status).toBe(200);
    expect(await viaActions.json()).toEqual(viaResource);
    expect(service.auditInserts.map((r) => r.transport)).toEqual(["rest", "rest"]);
  });
});
