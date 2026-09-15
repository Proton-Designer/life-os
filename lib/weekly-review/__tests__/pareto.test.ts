import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistractionPareto, UNCATEGORIZED_LABEL } from "../pareto";

type Resp = { data: unknown; error: unknown };

function makeClient(responses: Record<string, Resp>) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.then = (res: (v: Resp) => void) => res(responses[table] ?? { data: [], error: null });
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

describe("getDistractionPareto", () => {
  it("counts events by trigger name, descending", async () => {
    const supabase = makeClient({
      distraction_events: {
        data: [{ trigger_id: "t1" }, { trigger_id: "t1" }, { trigger_id: "t2" }, { trigger_id: "t1" }],
        error: null,
      },
      distraction_triggers: {
        data: [
          { id: "t1", name: "Phone" },
          { id: "t2", name: "Social media" },
        ],
        error: null,
      },
    });
    const result = await getDistractionPareto(supabase, "user-1");
    expect(result).toEqual([
      { label: "Phone", count: 3 },
      { label: "Social media", count: 1 },
    ]);
  });

  it("includes an ARCHIVED trigger's history rather than erasing it (the whole point of not reusing getTriggersForDomain)", async () => {
    const supabase = makeClient({
      distraction_events: { data: [{ trigger_id: "t1" }, { trigger_id: "t1" }], error: null },
      // Note: no `archived` column even selected here -- this query is
      // unfiltered by it, unlike lib/distractions/queries.ts's helpers.
      distraction_triggers: { data: [{ id: "t1", name: "An old, since-archived trigger" }], error: null },
    });
    const result = await getDistractionPareto(supabase, "user-1");
    expect(result).toEqual([{ label: "An old, since-archived trigger", count: 2 }]);
  });

  it("folds an event whose trigger can't be resolved into an explicit Uncategorized bar, never dropping it", async () => {
    const supabase = makeClient({
      distraction_events: { data: [{ trigger_id: "ghost" }, { trigger_id: "t1" }], error: null },
      distraction_triggers: { data: [{ id: "t1", name: "Phone" }], error: null },
    });
    const result = await getDistractionPareto(supabase, "user-1");
    expect(result).toContainEqual({ label: UNCATEGORIZED_LABEL, count: 1 });
    expect(result).toContainEqual({ label: "Phone", count: 1 });
  });

  it("returns an empty array, not an error, when there are no distraction events at all", async () => {
    const supabase = makeClient({});
    const result = await getDistractionPareto(supabase, "user-1");
    expect(result).toEqual([]);
  });

  it("propagates a real query error instead of silently returning an empty result", async () => {
    const supabase = makeClient({
      distraction_events: { data: null, error: { message: "boom" } },
    });
    await expect(getDistractionPareto(supabase, "user-1")).rejects.toMatchObject({ message: "boom" });
  });
});
