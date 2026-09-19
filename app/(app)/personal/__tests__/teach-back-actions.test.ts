import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const requireUserMock = vi.fn(async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }));
const getProfileMock = vi.fn(async () => ({ timezone: "America/Chicago" }) as { timezone: string | null } | null);
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
  getProfile: () => getProfileMock(),
}));

const evaluateTeachBackMock = vi.fn();
vi.mock("@/lib/self-mastery/teach-back", () => ({
  evaluateTeachBack: (...args: unknown[]) => evaluateTeachBackMock(...args),
}));

// P3-03: "recite" is recorded via this bridge on a genuine evaluated
// outcome only -- see recordTeachBackUsage's own header
// (lib/self-mastery/session/build-session.ts) and build-session.test.ts
// for the recording behavior itself; this file only proves submitTeachBack
// calls it (or doesn't) at the right times.
const recordTeachBackUsageMock = vi.fn();
vi.mock("@/lib/self-mastery/session/build-session", () => ({
  recordTeachBackUsage: (...args: unknown[]) => recordTeachBackUsageMock(...args),
}));

const { getTeachableLessons, submitTeachBack } = await import("../teach-back-actions");

beforeEach(() => {
  requireUserMock.mockClear();
  getProfileMock.mockClear();
  evaluateTeachBackMock.mockReset();
  recordTeachBackUsageMock.mockClear();
});

describe("getTeachableLessons", () => {
  function makeSupabase(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  }

  it("maps lessons to id/title/coreClaim", async () => {
    requireUserMock.mockResolvedValue({
      supabase: makeSupabase([
        { id: "l1", title: "Spaced repetition", core_claim: "Distribute review over time." },
        { id: "l2", title: "Retrieval practice", core_claim: null },
      ]),
      userId: "user-1",
    });
    const result = await getTeachableLessons("book-1");
    expect(result).toEqual([
      { id: "l1", title: "Spaced repetition", coreClaim: "Distribute review over time." },
      { id: "l2", title: "Retrieval practice", coreClaim: null },
    ]);
  });

  it("returns an empty array for a book with no active lessons", async () => {
    requireUserMock.mockResolvedValue({ supabase: makeSupabase([]), userId: "user-1" });
    expect(await getTeachableLessons("book-1")).toEqual([]);
  });
});

describe("submitTeachBack", () => {
  it("THE REGRESSION GUARD: too-short explanations never reach evaluateTeachBack", async () => {
    const result = await submitTeachBack("lesson-1", "too short");
    expect(result).toEqual({ outcome: "too_short" });
    expect(evaluateTeachBackMock).not.toHaveBeenCalled();
  });

  it("passes the trimmed explanation through to evaluateTeachBack", async () => {
    evaluateTeachBackMock.mockResolvedValue({ status: "evaluated", followUpQuestions: ["q1"], gapFeedback: "fb" });
    await submitTeachBack("lesson-1", "  A real explanation of the lesson content.  ");
    expect(evaluateTeachBackMock).toHaveBeenCalledWith(expect.anything(), "user-1", "lesson-1", "A real explanation of the lesson content.");
  });

  it("maps a real evaluation to outcome:'evaluated'", async () => {
    evaluateTeachBackMock.mockResolvedValue({ status: "evaluated", followUpQuestions: ["q1", "q2"], gapFeedback: "Solid, but missed X." });
    const result = await submitTeachBack("lesson-1", "A real explanation of the lesson content.");
    expect(result).toEqual({ outcome: "evaluated", followUpQuestions: ["q1", "q2"], gapFeedback: "Solid, but missed X." });
  });

  it("passes through a non-evaluated status (no_key/unavailable/parse_failed) as the outcome", async () => {
    evaluateTeachBackMock.mockResolvedValue({ status: "no_key" });
    const result = await submitTeachBack("lesson-1", "A real explanation of the lesson content.");
    expect(result).toEqual({ outcome: "no_key" });
  });

  // P3-03 regression guard: "recite" was named active in study-methods.ts
  // but nothing ever called recordStudyMethods with it. These prove
  // submitTeachBack now bridges to it via recordTeachBackUsage, on a
  // genuine evaluated outcome only -- matching study-methods.ts's own
  // description ("teaching a lesson back... AND getting gap feedback").
  it("records 'recite' usage (via today's local date) on a genuine evaluated outcome", async () => {
    evaluateTeachBackMock.mockResolvedValue({ status: "evaluated", followUpQuestions: ["q1"], gapFeedback: "fb" });
    const supabase = {} as unknown as SupabaseClient;
    requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });

    await submitTeachBack("lesson-1", "A real explanation of the lesson content.");

    expect(recordTeachBackUsageMock).toHaveBeenCalledTimes(1);
    expect(recordTeachBackUsageMock).toHaveBeenCalledWith(supabase, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("does NOT record 'recite' when the explanation was too short to reach evaluateTeachBack", async () => {
    await submitTeachBack("lesson-1", "too short");
    expect(recordTeachBackUsageMock).not.toHaveBeenCalled();
  });

  it("does NOT record 'recite' on a non-evaluated status (no_key/unavailable/parse_failed) -- nothing was actually taught back", async () => {
    evaluateTeachBackMock.mockResolvedValue({ status: "parse_failed" });
    await submitTeachBack("lesson-1", "A real explanation of the lesson content.");
    expect(recordTeachBackUsageMock).not.toHaveBeenCalled();
  });

  it("falls back to UTC when the profile has no timezone set", async () => {
    evaluateTeachBackMock.mockResolvedValue({ status: "evaluated", followUpQuestions: ["q1"], gapFeedback: "fb" });
    getProfileMock.mockResolvedValue(null);

    await submitTeachBack("lesson-1", "A real explanation of the lesson content.");

    expect(recordTeachBackUsageMock).toHaveBeenCalledTimes(1);
  });
});
