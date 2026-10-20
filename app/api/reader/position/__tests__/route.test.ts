import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authed = vi.fn();
const saveCore = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: () => authed() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ marker: "db" }) }));
vi.mock("@/lib/reader/server/core", () => ({ saveReaderPositionCore: (...a: unknown[]) => saveCore(...a) }));

import { POST } from "../route";

const BODY = { bookId: "33333333-3333-4333-8333-333333333333", wordIndex: 10, wpm: 300, clientUpdatedAt: "2026-10-19T23:00:00Z" };
const req = (body: string, headers: Record<string, string> = {}) =>
  new NextRequest("https://app.example.com/api/reader/position", { method: "POST", body, headers });

beforeEach(() => {
  authed.mockReset().mockResolvedValue({ id: "u1" });
  saveCore.mockReset().mockResolvedValue({ ok: true, wordIndex: 10 });
});

describe("POST /api/reader/position", () => {
  it("saves for the signed-in user from a text/plain beacon body", async () => {
    const res = await POST(req(JSON.stringify(BODY), { "content-type": "text/plain;charset=UTF-8", origin: "https://app.example.com" }));
    expect(res.status).toBe(200);
    expect(saveCore).toHaveBeenCalledWith({ marker: "db" }, "u1", BODY);
  });
  it("401 when signed out, without touching the core", async () => {
    authed.mockResolvedValue(null);
    expect((await POST(req(JSON.stringify(BODY)))).status).toBe(401);
    expect(saveCore).not.toHaveBeenCalled();
  });
  it("403 for a cross-site Origin", async () => {
    expect((await POST(req(JSON.stringify(BODY), { origin: "https://evil.example" }))).status).toBe(403);
    expect(saveCore).not.toHaveBeenCalled();
  });
  it("400 on garbage, 413 on an oversized body, 400 when the core rejects the values", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
    expect((await POST(req("x".repeat(5000)))).status).toBe(413);
    saveCore.mockResolvedValue({ ok: false, message: "bad" });
    expect((await POST(req(JSON.stringify(BODY)))).status).toBe(400);
  });
});
