import { describe, expect, it, vi } from "vitest";
import { getSessionDistractionCount } from "../queries";

type Call = { method: string; args: unknown[] };

function makeSupabase(count: number, calls: Call[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.then = (resolve: (v: { count: number; error: null }) => void) => resolve({ count, error: null });
  return { from: vi.fn(() => chain) };
}

describe("getSessionDistractionCount (#52) — the live 'N this session' counter's read", () => {
  it("counts distraction_events scoped to this user AND this session id", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase(3, calls);
    const result = await getSessionDistractionCount(supabase as never, "user-1", "session-1");

    expect(supabase.from).toHaveBeenCalledWith("distraction_events");
    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["session_id", "session-1"]);
    expect(result).toBe(3);
  });

  it("returns 0 rather than null when the session has no distractions yet", async () => {
    const calls: Call[] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: { count: null; error: null }) => void) => resolve({ count: null, error: null });
    const supabase = { from: vi.fn(() => chain) };

    const result = await getSessionDistractionCount(supabase as never, "user-1", "session-1");
    expect(result).toBe(0);
  });
});
