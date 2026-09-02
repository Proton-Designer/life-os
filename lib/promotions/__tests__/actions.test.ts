import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * These tests exist for ONE behaviour above all others: a PostgREST insert
 * that writes no row returns `data: []` with NO error. A caller that only
 * checks `error` reports success for a write that never happened — which is
 * exactly what RLS refusing the insert looks like from here. Every "did it
 * save?" test below is really a test of that.
 */

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** A minimal PostgREST-shaped chain. Each table gets its own scripted result. */
function makeSupabase(script: Record<string, { data: unknown; error: unknown }>) {
  const calls: { table: string; payload?: unknown }[] = [];
  const from = (table: string) => {
    const result = script[table] ?? { data: null, error: null };
    const chain = {
      insert(payload: unknown) {
        calls.push({ table, payload });
        return chain;
      },
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      is() {
        return chain;
      },
      maybeSingle() {
        return chain;
      },
      returns() {
        return Promise.resolve(result);
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    return chain;
  };
  return { client: { from }, calls };
}

async function loadActions() {
  return import("../actions");
}

beforeEach(() => {
  requireUserMock.mockReset();
});

describe("promoteLesson", () => {
  it("refuses an empty commitment before touching the database", async () => {
    const { client, calls } = makeSupabase({});
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { promoteLesson } = await loadActions();

    const result = await promoteLesson({ lessonId: "l1", acceptedText: "   ", areaId: "a1" });

    expect(result).toEqual({ ok: false, message: expect.stringContaining("even one line") });
    expect(calls).toHaveLength(0);
  });

  it("reports a FAILURE when the insert returns no row and no error", async () => {
    // The whole point. `error: null` and `data: []` is a refused write.
    const { client } = makeSupabase({ lesson_promotions: { data: [], error: null } });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { promoteLesson } = await loadActions();

    const result = await promoteLesson({ lessonId: "l1", acceptedText: "Do the thing", areaId: "a1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("didn't save");
  });

  it("turns the active-per-lesson unique violation into a sentence, not a stack trace", async () => {
    const { client } = makeSupabase({ lesson_promotions: { data: null, error: { code: "23505" } } });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { promoteLesson } = await loadActions();

    const result = await promoteLesson({ lessonId: "l1", acceptedText: "Do the thing", areaId: "a1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("already testing this lesson");
  });

  it("never sends user_id — the trigger sets it from the caller", async () => {
    const { client, calls } = makeSupabase({ lesson_promotions: { data: [{ id: "p1" }], error: null } });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { promoteLesson } = await loadActions();

    const result = await promoteLesson({ lessonId: "l1", acceptedText: "  Do the thing  ", areaId: "a1" });

    expect(result).toEqual({ ok: true, promotionId: "p1" });
    expect(calls[0]?.payload).toEqual({ lesson_id: "l1", area_id: "a1", accepted_text: "Do the thing" });
    expect(calls[0]?.payload).not.toHaveProperty("user_id");
  });
});

describe("recordVerdict", () => {
  it("demands a reason for `abandoned` before writing anything", async () => {
    const { client, calls } = makeSupabase({});
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { recordVerdict } = await loadActions();

    const result = await recordVerdict({ promotionId: "p1", verdict: "abandoned" });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses a second verdict on an already-retired promotion", async () => {
    // The bridge guard until 128 makes this a database guarantee.
    const { client, calls } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: "2026-09-01T00:00:00Z" }, error: null },
    });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { recordVerdict } = await loadActions();

    const result = await recordVerdict({ promotionId: "p1", verdict: "adopted" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("already given this one its verdict");
    expect(calls.filter((c) => c.table === "lesson_verdicts")).toHaveLength(0);
  });

  it("refuses when the promotion is not visible to this caller", async () => {
    // RLS filtering the row out and the row not existing are the same shape
    // from here, and both mean: do not write.
    const { client } = makeSupabase({ lesson_promotions: { data: null, error: null } });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { recordVerdict } = await loadActions();

    const result = await recordVerdict({ promotionId: "p1", verdict: "adopted" });

    expect(result.ok).toBe(false);
  });

  it("writes a still_testing verdict with no reason and leaves the promotion active", async () => {
    const { client, calls } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: [{ id: "v1" }], error: null },
    });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { recordVerdict } = await loadActions();

    const result = await recordVerdict({ promotionId: "p1", verdict: "still_testing" });

    expect(result).toEqual({ ok: true });
    expect(calls.find((c) => c.table === "lesson_verdicts")?.payload).toEqual({
      promotion_id: "p1",
      verdict: "still_testing",
      reason: null,
    });
  });

  it("maps 128's 55000 to the already-judged sentence, not the missing-reason one", async () => {
    // The race this function's read cannot win: the row was active when we
    // read it and retired by the time we wrote. 128's trigger refuses, and
    // the user must get the sentence about their actual mistake.
    const { client } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: null, error: { code: "55000" } },
    });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { recordVerdict } = await loadActions();

    const result = await recordVerdict({ promotionId: "p1", verdict: "adopted" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("already given this one its verdict");
  });

  it("reports a FAILURE when the verdict insert returns no row and no error", async () => {
    const { client } = makeSupabase({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: [], error: null },
    });
    requireUserMock.mockResolvedValue({ supabase: client, userId: "u1" });
    const { recordVerdict } = await loadActions();

    const result = await recordVerdict({ promotionId: "p1", verdict: "adopted" });

    expect(result.ok).toBe(false);
  });
});
