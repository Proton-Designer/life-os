import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const requireUserMock = vi.fn(async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }));
const getProfileMock = vi.fn(async () => ({ timezone: "America/Chicago" }) as { timezone: string | null } | null);
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
  getProfile: () => getProfileMock(),
}));

const evaluateTeachBackMock = vi.fn();
const fetchTeachableLessonMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ title: "T", core_claim: "C", mechanism: null, action_template: null, provenance_quote: "q" }));
vi.mock("@/lib/self-mastery/teach-back", () => ({
  evaluateTeachBack: (...args: unknown[]) => evaluateTeachBackMock(...args),
  fetchTeachableLesson: (...args: unknown[]) => fetchTeachableLessonMock(...args),
}));
const routeMock = vi.fn(async (..._a: unknown[]): Promise<string> => "inline");
vi.mock("@/lib/agent-jobs/route", () => ({ routeAiRequest: (...a: unknown[]) => routeMock(...a) }));
const enqueueMock = vi.fn(async (..._a: unknown[]) => "job-1");
vi.mock("@/lib/agent-jobs/core", () => ({ enqueueAgentJobCore: (...a: unknown[]) => enqueueMock(...a) }));

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
  routeMock.mockReset().mockResolvedValue("inline");
  enqueueMock.mockClear();
  fetchTeachableLessonMock.mockClear();
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

describe("submitTeachBack — no key, connected agent (feedback later)", () => {
  beforeEach(() => routeMock.mockResolvedValue("queue"));
  const LESSON = "44444444-4444-4444-8444-444444444444";
  const EXPLANATION = "Spaced repetition works because forgetting is gradual and each review resets the curve.";

  it("saves the explanation as a job on the lesson (with the lesson's own content for the agent) and says queued; the model is not called", async () => {
    expect(await submitTeachBack(LESSON, EXPLANATION)).toEqual({ outcome: "queued" });
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), {
      kind: "self_mastery.teach_back_grade",
      subjectId: LESSON,
      input: { lesson: expect.objectContaining({ title: "T" }), explanation: EXPLANATION },
    });
    expect(evaluateTeachBackMock).not.toHaveBeenCalled();
    expect(recordTeachBackUsageMock).not.toHaveBeenCalled(); // "recite" is recorded only on a genuine evaluation
  });

  it("a too-short explanation is still too_short, never queued", async () => {
    expect(await submitTeachBack(LESSON, "short")).toEqual({ outcome: "too_short" });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("a lesson that is not the caller's / not active is parse_failed, never queued", async () => {
    fetchTeachableLessonMock.mockResolvedValueOnce(null);
    expect(await submitTeachBack(LESSON, EXPLANATION)).toEqual({ outcome: "parse_failed" });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("caps the queued explanation at the in-app limit; a full queue reads as unavailable", async () => {
    await submitTeachBack(LESSON, "x".repeat(5000));
    expect((enqueueMock.mock.calls[0]![1] as { input: { explanation: string } }).input.explanation).toHaveLength(4000);
    enqueueMock.mockRejectedValueOnce(new Error("too many jobs"));
    expect(await submitTeachBack(LESSON, EXPLANATION)).toEqual({ outcome: "unavailable" });
  });
});
