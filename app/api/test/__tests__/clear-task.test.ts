// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { calls } = vi.hoisted(() => ({ calls: [] as Array<[string, ...unknown[]]> }));

vi.mock("../check-secret", () => ({ checkSecret: () => true }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      calls.push(["from", table]);
      const chain: Record<string, unknown> = {};
      chain.delete = () => (calls.push(["delete"]), chain);
      chain.eq = (c: string, v: unknown) => (calls.push(["eq", c, v]), chain);
      chain.like = (c: string, v: unknown) => (calls.push(["like", c, v]), Promise.resolve({ error: null }));
      chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return chain;
    },
  }),
}));

import { DELETE } from "../clear-task/route";

const call = (body: unknown) => DELETE(new NextRequest("http://localhost/api/test/clear-task", { method: "DELETE", body: JSON.stringify(body) }));

beforeEach(() => (calls.length = 0));

describe("clear-task", () => {
  it("title deletes the exact title for this user", async () => {
    expect((await call({ title: "T1" })).status).toBe(200);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "title", "T1"]);
  });

  it("titlePrefix deletes by LIKE prefix for this user only", async () => {
    expect((await call({ titlePrefix: "Playwright tap-to-complete " })).status).toBe(200);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["like", "title", "Playwright tap-to-complete %"]);
  });

  it("refuses a short or wildcard prefix (it must never be able to match real data) and an empty body", async () => {
    for (const bad of [{ titlePrefix: "abc" }, { titlePrefix: "Playwright%" }, { titlePrefix: "Playwri_ht tap" }, {}]) {
      expect((await call(bad)).status).toBe(400);
    }
    expect(calls.find((c) => c[0] === "like")).toBeUndefined();
  });
});
