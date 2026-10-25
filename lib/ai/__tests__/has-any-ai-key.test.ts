import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const { hasAnyAiKey } = await import("../resolve-key");

function client(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.limit = vi.fn(async () => result);
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe("hasAnyAiKey — a key for ANY provider counts (ingestion and the gateway are multi-provider)", () => {
  it("true when the person has saved a key for any provider", async () => {
    expect(await hasAnyAiKey(client({ data: [{ provider: "openai" }], error: null }), "u1")).toBe(true);
  });
  it("false when they have none, and on a read error (the empty state is only a hint, never an error)", async () => {
    expect(await hasAnyAiKey(client({ data: [], error: null }), "u1")).toBe(false);
    expect(await hasAnyAiKey(client({ data: null, error: { message: "x" } }), "u1")).toBe(false);
  });
});
