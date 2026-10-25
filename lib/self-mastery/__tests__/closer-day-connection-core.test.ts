import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const hasAnyAiKeyMock = vi.fn();
vi.mock("@/lib/ai/resolve-key", () => ({ hasAnyAiKey: (...a: unknown[]) => hasAnyAiKeyMock(...a) }));
const { getCloserDayConnectionCore } = await import("../closer-day-connection-core");

function client(stored: { connection_text: string; provider: string | null; model: string | null } | null) {
  const eqs: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((c: string, v: unknown) => ((eqs[c] = v), chain));
  chain.maybeSingle = vi.fn(async () => ({ data: stored, error: null }));
  return { c: { from: vi.fn(() => chain) } as unknown as SupabaseClient, eqs };
}

describe("getCloserDayConnectionCore", () => {
  it("returns an agent-written line (scoped to this user, card and day) with its source and never calls the model", async () => {
    const generate = vi.fn();
    const { c, eqs } = client({ connection_text: "Your 7:00 PM quiz uses this.", provider: "mcp", model: "Claude" });
    const res = await getCloserDayConnectionCore(c, "u1", "card-1", "2026-10-25", generate);
    expect(res).toEqual({ kind: "line", text: "Your 7:00 PM quiz uses this.", sourceLabel: "Written by Claude via your connector" });
    expect(eqs).toEqual({ user_id: "u1", card_id: "card-1", connection_date: "2026-10-25" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("with nothing stored and no key at all, says so honestly (the empty state), without calling the model", async () => {
    hasAnyAiKeyMock.mockResolvedValue(false);
    const generate = vi.fn();
    const res = await getCloserDayConnectionCore(client(null).c, "u1", "card-1", "2026-10-25", generate);
    expect(res).toEqual({ kind: "no_ai" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("with nothing stored and a key, uses the generator; its null stays null (nothing due is not an error)", async () => {
    hasAnyAiKeyMock.mockResolvedValue(true);
    expect(await getCloserDayConnectionCore(client(null).c, "u1", "card-1", "2026-10-25", async () => "Ties to Problem Set 3.")).toEqual({
      kind: "line",
      text: "Ties to Problem Set 3.",
      sourceLabel: null,
    });
    expect(await getCloserDayConnectionCore(client(null).c, "u1", "card-1", "2026-10-25", async () => null)).toBeNull();
  });
});
