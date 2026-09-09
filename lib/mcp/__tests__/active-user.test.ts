import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserActive } from "../active-user";

function makeClient(getUserByIdImpl: () => Promise<{ data: { user: unknown } | null; error: unknown }>) {
  return { auth: { admin: { getUserById: vi.fn(getUserByIdImpl) } } } as unknown as SupabaseClient;
}

describe("isUserActive — R4a, the check GoTrue would have made that the signing path skips", () => {
  it("is ACTIVE for a real, unbanned, non-deleted user", async () => {
    const client = makeClient(async () => ({ data: { user: { id: "u1", banned_until: null, deleted_at: null } }, error: null }));
    expect(await isUserActive(client, "u1")).toBe(true);
  });

  it("is NOT active when the lookup errors (fails closed)", async () => {
    const client = makeClient(async () => ({ data: null, error: { message: "not found" } }));
    expect(await isUserActive(client, "ghost")).toBe(false);
  });

  it("is NOT active when the user is soft-deleted", async () => {
    const client = makeClient(async () => ({
      data: { user: { id: "u1", deleted_at: "2026-01-01T00:00:00Z", banned_until: null } },
      error: null,
    }));
    expect(await isUserActive(client, "u1")).toBe(false);
  });

  it("is NOT active while a ban is still in the future", async () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const client = makeClient(async () => ({ data: { user: { id: "u1", banned_until: farFuture, deleted_at: null } }, error: null }));
    expect(await isUserActive(client, "u1")).toBe(false);
  });

  it("IS active once a past ban has expired", async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const client = makeClient(async () => ({ data: { user: { id: "u1", banned_until: past, deleted_at: null } }, error: null }));
    expect(await isUserActive(client, "u1")).toBe(true);
  });
});
