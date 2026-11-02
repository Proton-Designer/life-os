import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServiceClient, fakeUserClient, TOKEN_ROW } from "./fake-db";

/**
 * The MyHomeBase console's token over the REAL REST adapter (/api/v1): scopes ["kill_list"] only. Same harness as route.test.ts (real Request objects; only the service
 * client, verifyAccessToken, isUserActive and the session mint are mocked). It may verify itself (/me) and read / set / set_completed / clear the Kill List; every other
 * route is a 403 insufficient_scope that never reaches the tool.
 */

type Verified = { userId: string; tokenId: string; scopes: ("read" | "write" | "kill_list")[] } | null;
const verifyAccessTokenMock = vi.fn(async (_c: unknown, raw: string): Promise<Verified> => {
  if (!raw.startsWith("lifeos_pat_")) return null;
  return raw.includes("kill") ? { userId: "user-1", tokenId: "tok-kl", scopes: ["kill_list"] } : { userId: "user-1", tokenId: "tok-1", scopes: ["read", "write"] };
});
vi.mock("next/server", () => ({ after: (task: () => unknown) => void task() }));
vi.mock("@/lib/mcp/tokens", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/tokens")>("@/lib/mcp/tokens");
  return { ...actual, verifyAccessToken: verifyAccessTokenMock };
});
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));
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
  userClientOpts = { tokens: [{ ...TOKEN_ROW, id: "tok-kl", label: "MyHomeBase console", scopes: ["kill_list"], client_kind: "pat" }] };
  const { __resetAuthFailureCacheForTests } = await import("@/lib/mcp/auth-failure-limit");
  __resetAuthFailureCacheForTests();
});

const BASE = "https://lifeos.test/api/v1";
const KILL = { Authorization: "Bearer lifeos_pat_kill" };
const BROAD = { Authorization: "Bearer lifeos_pat_live" };
const D = "2026-11-02";
const req = (p: string, init: { headers: Record<string, string>; body?: unknown }) =>
  new Request(`${BASE}${p}`, { method: init.body !== undefined ? "POST" : "GET", headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
const catchAll = () => import("../[...path]/route");

describe("kill_list token over REST", () => {
  it("GET /me reports exactly ['kill_list'] (what the console checks before it stores the token)", async () => {
    const { GET } = await import("../me/route");
    const res = await GET(req("/me", { headers: KILL }));
    expect(res.status).toBe(200);
    expect((await res.json()).token).toEqual(expect.objectContaining({ id: "tok-kl", label: "MyHomeBase console", scopes: ["kill_list"] }));
    expect(service.auditInserts).toEqual([expect.objectContaining({ operation: "discovery.me", outcome: "ok", token_id: "tok-kl" })]);
  });

  it("reads the Kill List (GET /business/kill_list_item?filter[date]=)", async () => {
    const { GET } = await catchAll();
    const res = await GET(req(`/business/kill_list_item?filter[date]=${D}&detail=full`, { headers: KILL }));
    expect(res.status).toBe(200);
    expect(service.auditInserts).toEqual([expect.objectContaining({ operation: "business.kill_list_item.read", outcome: "ok", token_id: "tok-kl" })]);
  });

  it.each(["set", "set_completed", "clear"])("POST /business/kill_list_item/%s passes the scope gate (audited under its own operation)", async (action) => {
    const { POST } = await catchAll();
    const patch = action === "set" ? { date: D, position: 0, text: "x" } : action === "set_completed" ? { date: D, position: 0, completed: true } : { date: D, position: 0 };
    const res = await POST(req(`/business/kill_list_item/${action}`, { headers: KILL, body: { patch } }));
    expect(res.status).not.toBe(403);
    expect(service.auditInserts).toEqual([expect.objectContaining({ operation: `business.kill_list_item.${action}`, token_id: "tok-kl", transport: "rest" })]);
  });

  it.each([
    ["toggle", "POST", "/business/kill_list_item/toggle", { id: "i" }],
    ["write another domain", "POST", "/work/task/add", { patch: { title: "x" } }],
    ["read another domain", "GET", "/work/task", undefined],
    ["read the weekly goal", "GET", "/business/weekly_goal", undefined],
    ["capabilities", "GET", "/capabilities", undefined],
    ["manage/widgets", "GET", "/manage/widgets", undefined],
    ["the generic /actions tool, another write", "POST", "/actions", { tool: "write", args: { domain: "work", entity: "task", action: "add", patch: { title: "x" } } }],
    ["the GET write form, another write", "GET", `/write/work/task/add?patch=${encodeURIComponent(JSON.stringify({ title: "x" }))}`, undefined],
  ])("%s is 403 insufficient_scope and never runs", async (_n, method, path, body) => {
    const { GET, POST } = await catchAll();
    const res = method === "POST" ? await POST(req(path, { headers: KILL, body })) : await GET(req(path, { headers: KILL }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("insufficient_scope");
    expect(service.auditInserts).toEqual([expect.objectContaining({ outcome: "denied", token_id: "tok-kl" })]);
  });

  it("CONTROL: the same refused calls are NOT 403 for a read+write token (so the 403s above are the scope's doing)", async () => {
    const { GET, POST } = await catchAll();
    expect((await POST(req("/work/task/add", { headers: BROAD, body: { patch: { title: "x" } } }))).status).not.toBe(403);
    expect((await GET(req("/work/task", { headers: BROAD }))).status).not.toBe(403);
  });
});
