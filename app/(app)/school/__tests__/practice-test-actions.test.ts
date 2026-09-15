import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "upsert", "update", "in"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(resolvedValue));
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

let currentChain: ReturnType<typeof makeChain>;
const requireUserMock = vi.fn(async () => ({
  supabase: { from: vi.fn(() => currentChain) } as unknown as SupabaseClient,
  userId: "user-1",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { getMyPracticeTests, getPracticeTestQuestions, submitPracticeTestAnswer, completePracticeTest } = await import("../practice-test-actions");

beforeEach(() => {
  // mockReset (not mockClear) -- several describe blocks below call
  // requireUserMock.mockResolvedValue(...) to point at their own
  // per-table fake client, which otherwise bleeds into every later test
  // (mockResolvedValue sets a lasting implementation, mockClear only
  // clears call history). Restored to the default currentChain-based
  // implementation every test.
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ supabase: { from: vi.fn(() => currentChain) } as unknown as SupabaseClient, userId: "user-1" });
});

describe("getMyPracticeTests", () => {
  it("maps rows to camelCase, coercing score_pct from string to number", async () => {
    currentChain = makeChain({
      data: [
        { id: "pt1", assessment_id: "a1", interval_label: "T-14", question_ids: ["q1", "q2"], status: "completed", score_pct: "80.00", created_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-01T01:00:00Z" },
        { id: "pt2", assessment_id: "a1", interval_label: "T-7", question_ids: ["q1"], status: "pending", score_pct: null, created_at: "2026-09-08T00:00:00Z", completed_at: null },
      ],
      error: null,
    });
    const result = await getMyPracticeTests("class-1");
    expect(result).toEqual([
      { id: "pt1", assessmentId: "a1", intervalLabel: "T-14", questionIds: ["q1", "q2"], status: "completed", scorePct: 80, createdAt: "2026-09-01T00:00:00Z", completedAt: "2026-09-01T01:00:00Z" },
      { id: "pt2", assessmentId: "a1", intervalLabel: "T-7", questionIds: ["q1"], status: "pending", scorePct: null, createdAt: "2026-09-08T00:00:00Z", completedAt: null },
    ]);
  });

  it("returns an empty array for a class with no practice tests", async () => {
    currentChain = makeChain({ data: [], error: null });
    expect(await getMyPracticeTests("class-1")).toEqual([]);
  });
});

describe("getPracticeTestQuestions", () => {
  function makeSupabase(questionIds: string[], questionRows: { id: string; prompt: string; answer: string }[]) {
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.in = vi.fn(() => chain);
      chain.single = vi.fn(() => Promise.resolve({ data: { question_ids: questionIds }, error: null }));
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
        if (table === "questions") return resolve({ data: questionRows, error: null });
        resolve({ data: null, error: null });
      };
      return chain;
    });
    return { from } as unknown as SupabaseClient;
  }

  it("returns questions in the SAME order as question_ids, not the order the table happens to return them", async () => {
    requireUserMock.mockResolvedValue({
      supabase: makeSupabase(
        ["q2", "q1"],
        [
          { id: "q1", prompt: "First in DB", answer: "a1" },
          { id: "q2", prompt: "Second in DB", answer: "a2" },
        ]
      ),
      userId: "user-1",
    });
    const result = await getPracticeTestQuestions("pt1");
    expect(result.map((q) => q.id)).toEqual(["q2", "q1"]);
  });

  it("returns an empty array when the test has no questions, without querying the questions table", async () => {
    const supabase = makeSupabase([], []);
    requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });
    expect(await getPracticeTestQuestions("pt1")).toEqual([]);
  });

  it("silently drops a question id that no longer resolves (e.g. deleted) rather than crashing", async () => {
    requireUserMock.mockResolvedValue({
      supabase: makeSupabase(["q1", "q-deleted"], [{ id: "q1", prompt: "Still here", answer: "a1" }]),
      userId: "user-1",
    });
    const result = await getPracticeTestQuestions("pt1");
    expect(result.map((q) => q.id)).toEqual(["q1"]);
  });
});

describe("submitPracticeTestAnswer", () => {
  it("upserts on the (user, test, question) conflict key -- re-answering updates, never duplicates", async () => {
    currentChain = makeChain({ data: null, error: null });
    await submitPracticeTestAnswer("pt1", "q1", true);
    expect(currentChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", practice_test_id: "pt1", question_id: "q1", self_reported_correct: true }),
      expect.objectContaining({ onConflict: "user_id,practice_test_id,question_id" })
    );
  });
});

describe("completePracticeTest", () => {
  /** Per-table dispatcher -- completePracticeTest hits `practice_tests` twice (a `.single()` read, then an `.update()`) and `practice_test_answers` once, so one shared chain can't represent all three calls correctly. */
  function makeSupabase(opts: { questionIds: string[]; answers: { question_id: string; self_reported_correct: boolean }[] }) {
    const updateCalls: Record<string, unknown>[] = [];
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn(() => Promise.resolve({ data: { question_ids: opts.questionIds }, error: null }));
      chain.update = vi.fn((patch: Record<string, unknown>) => {
        updateCalls.push(patch);
        return chain;
      });
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
        if (table === "practice_test_answers") return resolve({ data: opts.answers, error: null });
        resolve({ data: null, error: null }); // the update's own terminal await
      };
      return chain;
    });
    return { supabase: { from } as unknown as SupabaseClient, updateCalls };
  }

  it("THE REGRESSION GUARD: an unanswered question counts as NOT correct -- never excluded from the denominator", async () => {
    // 3 questions, only 1 answered (correctly) -- score must be 1/3, not 1/1.
    const { supabase } = makeSupabase({ questionIds: ["q1", "q2", "q3"], answers: [{ question_id: "q1", self_reported_correct: true }] });
    requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });

    const result = await completePracticeTest("pt1");
    expect(result.scorePct).toBeCloseTo(33.33, 1);
    expect(result.questionCount).toBe(3);
    expect(result.answeredCount).toBe(1);
  });

  it("a fully-answered, all-correct test scores 100", async () => {
    const { supabase } = makeSupabase({
      questionIds: ["q1", "q2"],
      answers: [
        { question_id: "q1", self_reported_correct: true },
        { question_id: "q2", self_reported_correct: true },
      ],
    });
    requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });

    const result = await completePracticeTest("pt1");
    expect(result.scorePct).toBe(100);
  });

  it("a self-reported INCORRECT answer does not count toward the score", async () => {
    const { supabase } = makeSupabase({
      questionIds: ["q1", "q2"],
      answers: [
        { question_id: "q1", self_reported_correct: true },
        { question_id: "q2", self_reported_correct: false },
      ],
    });
    requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });

    const result = await completePracticeTest("pt1");
    expect(result.scorePct).toBe(50);
  });

  it("marks status completed and stamps completed_at", async () => {
    const { supabase, updateCalls } = makeSupabase({ questionIds: ["q1"], answers: [] });
    requireUserMock.mockResolvedValue({ supabase, userId: "user-1" });

    await completePracticeTest("pt1");

    expect(updateCalls[0]).toMatchObject({ status: "completed" });
    expect(updateCalls[0]!.completed_at).toBeTruthy();
  });
});
