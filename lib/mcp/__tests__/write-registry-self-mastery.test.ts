import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction } from "../write-registry";

function textOf(outcome: Awaited<ReturnType<NonNullable<ReturnType<typeof getWriteAction>>["handler"]>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return JSON.parse(block.text);
}

const now = new Date("2026-09-08T20:00:00.000Z");

/** A generic per-table/rpc scripted mock, same shape as the other write-registry dispatch test files. */
function makeClient(
  script: Record<string, { data: unknown; error: unknown }> = {},
  rpcImpl?: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>,
) {
  const inserts: { table: string; payload: unknown }[] = [];
  const from = vi.fn((table: string) => {
    const result = script[table] ?? { data: null, error: null };
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
  return { client: { from, rpc } as unknown as SupabaseClient, inserts, rpc };
}

const CARD_STATE_ROW = { stability: 5, difficulty: 3, due_at: "2026-09-08T00:00:00Z", reps: 2, lapses: 0, state: "review", last_review_at: "2026-09-01T00:00:00Z", learning_steps: 0 };
const SETTINGS_ROW = { session_target_minutes: 20, daily_new_limit: 10, ai_grading_enabled: false, desired_retention: 0.9 };

describe("self_mastery.review.grade — dispatch", () => {
  it("grades via patch.card_id/patch.rating, no top-level id needed", async () => {
    const action = getWriteAction("self_mastery", "review", "grade")!;
    const { client } = makeClient({ card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } }, async () => ({
      data: { id: "review-abc" },
      error: null,
    }));

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { card_id: "c1", rating: 3 });

    expect(textOf(outcome)).toMatchObject({ id: "review-abc", cardId: "c1", rating: 3 });
    const structured = outcome.result.structuredContent as Record<string, unknown>;
    expect(structured.updated_at).toBe(now.toISOString());
  });

  it("rejects a missing card_id before ever touching the database", async () => {
    const action = getWriteAction("self_mastery", "review", "grade")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { rating: 3 })).rejects.toThrow(/patch\.card_id/i);
  });

  it("rejects a rating outside 1-4", async () => {
    const action = getWriteAction("self_mastery", "review", "grade")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { card_id: "c1", rating: 5 })).rejects.toThrow(/patch\.rating/i);
  });

  it("rejects an invalid confidence value, naming the real options", async () => {
    const action = getWriteAction("self_mastery", "review", "grade")!;
    const { client } = makeClient({ card_states: { data: CARD_STATE_ROW, error: null }, user_settings: { data: SETTINGS_ROW, error: null } });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { card_id: "c1", rating: 3, confidence: "very_sure" }),
    ).rejects.toThrow(/patch\.confidence must be one of/i);
  });

  it("surfaces the real 'no card_states row' error when the card was never seeded for this account", async () => {
    const action = getWriteAction("self_mastery", "review", "grade")!;
    const { client } = makeClient({ card_states: { data: null, error: null } });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { card_id: "c1", rating: 3 })).rejects.toThrow(
      /No card_states row for card "c1"/,
    );
  });
});

describe("self_mastery.lesson_promotion.record_verdict — dispatch", () => {
  it("targets the promotion via the TOP-LEVEL id, not a patch field", async () => {
    const action = getWriteAction("self_mastery", "lesson_promotion", "record_verdict")!;
    const { client } = makeClient({
      lesson_promotions: { data: { id: "p1", retired_at: null }, error: null },
      lesson_verdicts: { data: { id: "v1", verdict_at: "2026-09-08T20:00:00Z" }, error: null },
    });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "p1" }, { verdict: "still_testing" });

    expect(textOf(outcome)).toEqual({ id: "v1", promotionId: "p1", verdict: "still_testing", verdictAt: "2026-09-08T20:00:00Z" });
  });

  it("rejects when no top-level id is given", async () => {
    const action = getWriteAction("self_mastery", "lesson_promotion", "record_verdict")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { verdict: "still_testing" })).rejects.toThrow(
      /requires the top-level `id`/i,
    );
  });

  it("rejects an unknown verdict value", async () => {
    const action = getWriteAction("self_mastery", "lesson_promotion", "record_verdict")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "p1" }, { verdict: "maybe" })).rejects.toThrow(
      /patch\.verdict must be one of/i,
    );
  });

  it("rejects 'abandoned' with no reason, same message the app's own recordVerdict has always shown", async () => {
    const action = getWriteAction("self_mastery", "lesson_promotion", "record_verdict")!;
    const { client } = makeClient({ lesson_promotions: { data: { id: "p1", retired_at: null }, error: null } });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "p1" }, { verdict: "abandoned" })).rejects.toThrow(
      "Say what didn't work. A month from now that sentence is the whole value.",
    );
  });
});

describe("self_mastery.self_explanation.log — dispatch", () => {
  it("logs with no top-level id -- always a new row", async () => {
    const action = getWriteAction("self_mastery", "self_explanation", "log")!;
    const { client, inserts } = makeClient({ self_explanations: { data: { id: "se-1", created_at: "2026-09-08T20:00:00Z" }, error: null } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { lesson_id: "l1", prompt: "Explain it", response: "My reflection" });

    expect(textOf(outcome)).toEqual({ id: "se-1", lessonId: "l1", updatedAt: "2026-09-08T20:00:00Z" });
    expect(inserts[0]?.payload).toMatchObject({ session_id: null, lesson_id: "l1", response: "My reflection" });
  });

  it("a null/omitted response is a legitimate skip, never blocked", async () => {
    const action = getWriteAction("self_mastery", "self_explanation", "log")!;
    const { client } = makeClient({ self_explanations: { data: { id: "se-2", created_at: "2026-09-08T20:00:00Z" }, error: null } });

    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { lesson_id: "l1", prompt: "Explain it" }),
    ).resolves.toBeTruthy();
  });

  it("rejects a missing prompt", async () => {
    const action = getWriteAction("self_mastery", "self_explanation", "log")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { lesson_id: "l1" })).rejects.toThrow(/patch\.prompt/i);
  });
});

describe("self_mastery write actions never reach lessons/cards/source_chunks", () => {
  /**
   * The lead's finding: the previous version of this test only asserted
   * `touchedTables.not.toContain(excluded)` — a check that passes just as
   * cleanly if the recorder never recorded anything at all (a broken mock,
   * a handler that silently no-oped) as it does if the constraint genuinely
   * holds. Absence-only assertions can't tell "proven safe" from "measured
   * nothing" apart; they look identical in the output. Fixed with a
   * POSITIVE CONTROL: assert the exact, complete set of tables AND rpc
   * calls these three handlers are expected to make, not just that three
   * named ones are missing from an unconstrained set. A handler that
   * quietly starts reaching for a fourth table (excluded or not) now fails
   * this test too, which "not.toContain" could never catch.
   */
  it("touches exactly card_states/user_settings/fsrs_user_parameters/lesson_promotions/lesson_verdicts/self_explanations and rpc submit_review -- nothing else, and never lessons/cards/source_chunks", async () => {
    const touchedTables = new Set<string>();
    const rpcCalls: string[] = [];
    const client = {
      from: vi.fn((table: string) => {
        touchedTables.add(table);
        const chain = {
          select: () => chain,
          eq: () => chain,
          insert: () => chain,
          maybeSingle: () => Promise.resolve({ data: table === "card_states" ? CARD_STATE_ROW : table === "user_settings" ? SETTINGS_ROW : { id: "x", retired_at: null }, error: null }),
          single: () => Promise.resolve({ data: { id: "x", verdict_at: "2026-09-08T20:00:00Z", created_at: "2026-09-08T20:00:00Z" }, error: null }),
        };
        return chain;
      }),
      rpc: vi.fn(async (name: string) => {
        rpcCalls.push(name);
        return { data: { id: "review-1" }, error: null };
      }),
    } as unknown as SupabaseClient;

    await getWriteAction("self_mastery", "review", "grade")!.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { card_id: "c1", rating: 3 });
    await getWriteAction("self_mastery", "lesson_promotion", "record_verdict")!.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "p1" },
      { verdict: "still_testing" },
    );
    await getWriteAction("self_mastery", "self_explanation", "log")!.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { lesson_id: "l1", prompt: "p" });

    // Positive control FIRST -- if this fails, the exclusion assertion
    // below is meaningless (either the recorder is broken, or a handler
    // reached for something unanticipated).
    expect(touchedTables.size).toBeGreaterThan(0);
    // P3-20: submitCardReview now reads fsrs_user_parameters (a SELECT-only
    // lookup for the caller's own tuned weights, gated on >=1000 reviews)
    // on every review.grade call -- a real, expected, reviewed addition to
    // this closed surface, not a regression.
    expect([...touchedTables].sort()).toEqual(["card_states", "fsrs_user_parameters", "lesson_promotions", "lesson_verdicts", "self_explanations", "user_settings"]);
    expect(rpcCalls).toEqual(["submit_review"]);

    // Now the exclusion is a real claim: this is the WHOLE set, and none
    // of the three excluded tables is in it.
    for (const excluded of ["lessons", "cards", "source_chunks"]) {
      expect(touchedTables).not.toContain(excluded);
    }
  });
});
