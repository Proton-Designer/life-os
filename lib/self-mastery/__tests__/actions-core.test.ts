import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { gradeReviewCore, logSelfExplanationCore } from "../actions-core";

/**
 * gradeReviewCore/logSelfExplanationCore are thin orchestration over
 * already-core-shaped functions in session/build-session.ts (fetchCardState/
 * loadSessionSettings/submitCardReview/submitSelfExplanation, none of which
 * call requireUser() internally) -- these tests prove the ORCHESTRATION
 * (what gets fetched, what gets passed through, what null means for a
 * caller with no app-tracked session), not FSRS itself (covered by
 * fsrs-scheduler's own tests) or submitCardReview's own RPC-arg mapping
 * (covered directly in build-session.test.ts).
 */

function makeClient(
  script: { card_states?: { data: unknown; error: unknown }; user_settings?: { data: unknown; error: unknown }; self_explanations?: { data: unknown; error: unknown } } = {},
  rpcImpl?: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>,
) {
  const inserts: { table: string; payload: unknown }[] = [];
  const from = vi.fn((table: string) => {
    const result = (script as Record<string, { data: unknown; error: unknown } | undefined>)[table] ?? { data: null, error: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      insert: (payload: unknown) => {
        inserts.push({ table, payload });
        return chain;
      },
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
    };
    return chain;
  });
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: { id: "review-1" }, error: null })));
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, inserts, rpc };
}

const CARD_STATE_ROW = { stability: 5, difficulty: 3, due_at: "2026-09-08T00:00:00Z", reps: 2, lapses: 0, state: "review", last_review_at: "2026-09-01T00:00:00Z", learning_steps: 0 };
const SETTINGS_ROW = { session_target_minutes: 20, daily_new_limit: 10, ai_grading_enabled: false, desired_retention: 0.9 };

describe("gradeReviewCore", () => {
  it("throws when there is no card_states row for this card on this account -- nothing to grade yet", async () => {
    const { client } = makeClient({ card_states: { data: null, error: null } });
    await expect(gradeReviewCore(client, "u1", { cardId: "c1", rating: 3, now: new Date("2026-09-08T12:00:00Z") })).rejects.toThrow(
      /No card_states row for card "c1"/,
    );
  });

  it("passes sessionId: null to the RPC -- an MCP-graded review has no app-tracked work_sessions row", async () => {
    let capturedArgs: Record<string, unknown> = {};
    const { client } = makeClient({ card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } }, async (name, args) => {
      capturedArgs = args as Record<string, unknown>;
      return { data: { id: "review-1" }, error: null };
    });

    await gradeReviewCore(client, "u1", { cardId: "c1", rating: 3, now: new Date("2026-09-08T12:00:00Z") });

    expect(capturedArgs.p_session_id).toBeNull();
  });

  it("defaults elapsedMs to 0 and answeredText to '' when omitted -- an honest 'I don't know' is legitimate, never blocked", async () => {
    let capturedArgs: Record<string, unknown> = {};
    const { client } = makeClient({ card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } }, async (name, args) => {
      capturedArgs = args as Record<string, unknown>;
      return { data: { id: "review-1" }, error: null };
    });

    await gradeReviewCore(client, "u1", { cardId: "c1", rating: 2, now: new Date("2026-09-08T12:00:00Z") });

    expect(capturedArgs.p_elapsed_ms).toBe(0);
    expect(capturedArgs.p_answered_text).toBe("");
    expect(capturedArgs.p_confidence).toBeUndefined();
  });

  it("passes rating/elapsedMs/answeredText/confidence straight through when given", async () => {
    let capturedArgs: Record<string, unknown> = {};
    const { client } = makeClient({ card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } }, async (name, args) => {
      capturedArgs = args as Record<string, unknown>;
      return { data: { id: "review-1" }, error: null };
    });

    await gradeReviewCore(client, "u1", {
      cardId: "c1",
      rating: 4,
      elapsedMs: 8000,
      answeredText: "my real answer",
      confidence: "sure",
      now: new Date("2026-09-08T12:00:00Z"),
    });

    expect(capturedArgs.p_rating).toBe(4);
    expect(capturedArgs.p_elapsed_ms).toBe(8000);
    expect(capturedArgs.p_answered_text).toBe("my real answer");
    expect(capturedArgs.p_confidence).toBe("sure");
  });

  it("never fabricates AI grading assist -- aiFeedback/aiSuggestedRating are always null", async () => {
    let capturedArgs: Record<string, unknown> = {};
    const { client } = makeClient({ card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } }, async (name, args) => {
      capturedArgs = args as Record<string, unknown>;
      return { data: { id: "review-1" }, error: null };
    });

    await gradeReviewCore(client, "u1", { cardId: "c1", rating: 3, now: new Date("2026-09-08T12:00:00Z") });

    expect(capturedArgs.p_ai_feedback).toBeNull();
    expect(capturedArgs.p_ai_suggested_rating).toBeNull();
  });

  it("returns the real review id and scheduledDays, with updatedAt from the given `now`, never a fresh Date()", async () => {
    const { client } = makeClient(
      { card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } },
      async () => ({ data: { id: "review-xyz" }, error: null }),
    );

    const now = new Date("2026-09-08T12:00:00Z");
    const result = await gradeReviewCore(client, "u1", { cardId: "c1", rating: 3, now });

    expect(result.id).toBe("review-xyz");
    expect(result.cardId).toBe("c1");
    expect(result.rating).toBe(3);
    expect(result.updatedAt).toBe(now.toISOString());
    expect(typeof result.scheduledDays).toBe("number");
  });

  it("surfaces a real RPC error rather than swallowing it", async () => {
    const { client } = makeClient({ card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } }, async () => ({
      data: null,
      error: { message: "submit_review: reps must increase by exactly 1 (was 2, proposed 4)" },
    }));

    await expect(gradeReviewCore(client, "u1", { cardId: "c1", rating: 3, now: new Date("2026-09-08T12:00:00Z") })).rejects.toThrow(/reps must increase/);
  });
});

describe("logSelfExplanationCore", () => {
  it("inserts with sessionId: null and returns the real id/updatedAt", async () => {
    const { client, inserts } = makeClient({ self_explanations: { data: { id: "se-1", created_at: "2026-09-08T12:00:00Z" }, error: null } });

    const result = await logSelfExplanationCore(client, "u1", { lessonId: "l1", prompt: "Explain in your own words", response: "My reflection" });

    expect(result).toEqual({ id: "se-1", lessonId: "l1", updatedAt: "2026-09-08T12:00:00Z" });
    expect(inserts[0]?.payload).toMatchObject({ user_id: "u1", lesson_id: "l1", session_id: null, response: "My reflection" });
  });

  it("a null response (a skip) is a legitimate row, never blocked", async () => {
    const { client } = makeClient({ self_explanations: { data: { id: "se-2", created_at: "2026-09-08T12:00:00Z" }, error: null } });

    await expect(logSelfExplanationCore(client, "u1", { lessonId: "l1", prompt: "Explain", response: null })).resolves.toMatchObject({ id: "se-2" });
  });
});
