import { describe, expect, it, vi } from "vitest";
import { getTodayDistractionCount } from "../queries";

function makeSupabase(count: number) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.then = (resolve: (v: { count: number; error: null }) => void) => resolve({ count, error: null });
  return { supabase: { from: vi.fn(() => chain) } as never, calls };
}

describe("getTodayDistractionCount — Deen Mode", () => {
  it("ON: plain count, no trigger join and no domain filter (as before)", async () => {
    const { supabase, calls } = makeSupabase(4);
    expect(await getTodayDistractionCount(supabase, "u", "2026-10-04", true)).toBe(4);
    expect(calls.some((c) => c.method === "neq")).toBe(false);
    expect(JSON.stringify(calls)).not.toContain("distraction_triggers");
  });

  it("OFF: joins the trigger and excludes domain deen", async () => {
    const { supabase, calls } = makeSupabase(2);
    expect(await getTodayDistractionCount(supabase, "u", "2026-10-04", false)).toBe(2);
    expect(JSON.stringify(calls.find((c) => c.method === "select"))).toContain("distraction_triggers!inner(domain)");
    expect(calls).toContainEqual({ method: "neq", args: ["distraction_triggers.domain", "deen"] });
  });
});
