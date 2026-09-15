import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOverconfidenceVerdict } from "../get-overconfidence-verdict";

type Call = { method: string; args: unknown[] };

function makeClient(rows: { confidence: "sure" | "think_so" | "guessing" | null; correct: boolean | null }[]) {
  const calls: Call[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not"]) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      });
    }
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve({ data: rows, error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("getOverconfidenceVerdict", () => {
  it("scopes the query to this user and excludes null confidence/correct at the DB layer", async () => {
    const { client, calls } = makeClient([]);
    await getOverconfidenceVerdict(client, "u1");
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "u1")).toBe(true);
    expect(calls.some((c) => c.method === "not" && c.args[0] === "confidence" && c.args[1] === "is" && c.args[2] === null)).toBe(true);
    expect(calls.some((c) => c.method === "not" && c.args[0] === "correct" && c.args[1] === "is" && c.args[2] === null)).toBe(true);
  });

  it("no rows -- insufficient_data, not an error", async () => {
    const { client } = makeClient([]);
    const result = await getOverconfidenceVerdict(client, "u1");
    expect(result.status).toBe("insufficient_data");
  });

  it("a row with a null confidence or correct (defense in depth past the DB filter) is excluded from the sample, not coerced", async () => {
    const rows = [
      ...Array.from({ length: 25 }, () => ({ confidence: "sure" as const, correct: true })),
      { confidence: null, correct: true }, // should never count
      { confidence: "sure" as const, correct: null }, // should never count
    ];
    const { client } = makeClient(rows);
    const result = await getOverconfidenceVerdict(client, "u1");
    if (result.status !== "insufficient_data") expect(result.totalSample).toBe(25);
  });

  it("passes a real, mixed sample through to the calibration engine correctly", async () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ confidence: "sure" as const, correct: true })),
      ...Array.from({ length: 10 }, () => ({ confidence: "sure" as const, correct: false })),
      ...Array.from({ length: 5 }, () => ({ confidence: "guessing" as const, correct: true })),
    ];
    const { client } = makeClient(rows);
    const result = await getOverconfidenceVerdict(client, "u1");
    expect(result.status).toBe("overconfident");
  });
});
