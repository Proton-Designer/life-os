import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProfileTool } from "../get-profile";

function makeClient(resolved: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => resolved);
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, chain, from };
}

describe("getProfileTool", () => {
  it("returns the profile row, scoped explicitly to the given user id (belt-and-suspenders over RLS)", async () => {
    const { client, chain, from } = makeClient({ data: { display_name: "Ayman", timezone: "America/Chicago" }, error: null });
    const outcome = await getProfileTool(client, "user-1");

    expect(from).toHaveBeenCalledWith("profiles");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(outcome.result.structuredContent).toEqual({ display_name: "Ayman", timezone: "America/Chicago" });
    expect(outcome.summary).toBe("returned profile");
  });

  it("returns an empty object, not an error, when there is no profile row yet", async () => {
    const { client } = makeClient({ data: null, error: null });
    const outcome = await getProfileTool(client, "user-1");
    expect(outcome.result.structuredContent).toEqual({});
    expect(outcome.summary).toMatch(/no profile row yet/);
  });

  it("throws on a DB error, so the wrapper's error path (and audit) actually fires", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    await expect(getProfileTool(client, "user-1")).rejects.toThrow(/boom/);
  });
});
