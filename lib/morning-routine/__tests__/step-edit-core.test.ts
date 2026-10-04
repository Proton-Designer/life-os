import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateLaunchStepCore } from "../step-edit-core";

type Call = [string, ...unknown[]];
function fake(opts: { habit?: unknown; updated?: unknown[] } = {}) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "update", "eq", "is"]) {
      chain[m] = vi.fn((...a: unknown[]) => {
        calls.push([`${table}.${m}`, ...a]);
        return chain;
      });
    }
    chain.maybeSingle = vi.fn(async () => ({ data: opts.habit ?? null, error: null }));
    chain.then = (r: (v: unknown) => void) => r({ data: opts.updated ?? [{ id: "s1" }], error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient<never>, calls };
}

describe("updateLaunchStepCore", () => {
  it("updates only the given fields, scoped to this user and not-archived, trimming and clearing blanks to null", async () => {
    const { client, calls } = fake();
    await updateLaunchStepCore(client as never, "u1", "s1", { label: "  stretch ", ifCue: "  ", fallbackText: "one roll" });
    expect(calls).toContainEqual(["morning_routine_items.update", { label: "stretch", if_cue: null, fallback_text: "one roll" }]);
    expect(calls).toContainEqual(["morning_routine_items.eq", "user_id", "u1"]);
    expect(calls).toContainEqual(["morning_routine_items.is", "archived_at", null]);
  });

  it.each([
    ["a blank label", { label: "   " }],
    ["a 121-char label", { label: "x".repeat(121) }],
    ["an 81-char cue", { ifCue: "x".repeat(81) }],
    ["an 81-char fallback", { fallbackText: "x".repeat(81) }],
  ])("rejects %s without writing", async (_n, patch) => {
    const { client, calls } = fake();
    await expect(updateLaunchStepCore(client as never, "u1", "s1", patch)).rejects.toThrow();
    expect(calls.some((c) => c[0].endsWith(".update"))).toBe(false);
  });

  it("a linked habit must be one of YOUR active habits (positive control: an active one links)", async () => {
    await expect(updateLaunchStepCore(fake({ habit: null }).client as never, "u1", "s1", { habitId: "h9" })).rejects.toThrow("isn't active");
    const ok = fake({ habit: { id: "h1" } });
    await updateLaunchStepCore(ok.client as never, "u1", "s1", { habitId: "h1" });
    expect(ok.calls).toContainEqual(["morning_routine_items.update", { habit_id: "h1" }]);
  });

  it("unlinking (habitId null) needs no habit lookup", async () => {
    const f = fake();
    await updateLaunchStepCore(f.client as never, "u1", "s1", { habitId: null });
    expect(f.calls.some((c) => c[0].startsWith("identity_habits"))).toBe(false);
  });

  it("a stale tap (no row updated) is an error, not a silent no-op", async () => {
    await expect(updateLaunchStepCore(fake({ updated: [] }).client as never, "u1", "s1", { label: "x" })).rejects.toThrow("no longer exists");
  });

  it("an empty patch writes nothing", async () => {
    const f = fake();
    await updateLaunchStepCore(f.client as never, "u1", "s1", {});
    expect(f.calls).toHaveLength(0);
  });
});
