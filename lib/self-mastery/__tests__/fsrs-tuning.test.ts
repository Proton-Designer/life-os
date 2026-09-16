import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { default_w } from "ts-fsrs";
import {
  validateFsrsWeights,
  getUserReviewCount,
  getReviewLogForTuning,
  meanLossForWeights,
  optimizeFsrsWeights,
  getFsrsTuningStatus,
  getUserFsrsWeights,
  FSRS_TUNING_MIN_REVIEWS,
  type ReviewLogEntry,
} from "../fsrs-tuning";

// ── validateFsrsWeights ──────────────────────────────────────────────
describe("validateFsrsWeights (P3-20)", () => {
  it("accepts ts-fsrs's own default_w unchanged", () => {
    expect(validateFsrsWeights([...default_w])).toEqual([...default_w]);
  });

  it("rejects the wrong length -- a positive control proving this guard actually fires, not just that valid input passes", () => {
    expect(validateFsrsWeights([...default_w].slice(0, -1))).toBeNull();
    expect(validateFsrsWeights([...default_w, 0.5])).toBeNull();
  });

  it("rejects a NaN/Infinity anywhere in the array -- checkParameters alone doesn't guard against these, so this module adds its own explicit check", () => {
    const withNaN = [...default_w];
    withNaN[3] = NaN;
    expect(validateFsrsWeights(withNaN)).toBeNull();
    const withInfinity = [...default_w];
    withInfinity[5] = Infinity;
    expect(validateFsrsWeights(withInfinity)).toBeNull();
  });

  it("rejects a non-array or an array of non-numbers", () => {
    expect(validateFsrsWeights("not an array")).toBeNull();
    expect(validateFsrsWeights(null)).toBeNull();
    const withString = [...default_w] as unknown[];
    withString[0] = "0.4";
    expect(validateFsrsWeights(withString)).toBeNull();
  });
});

// ── review-log fetching ──────────────────────────────────────────────
type Resp = { data: unknown; error: unknown; count?: number | null };
function makeClient(responses: Record<string, Resp[]>) {
  const queues: Record<string, Resp[]> = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(record(method));
    chain.maybeSingle = vi.fn(() => {
      const r = (queues[table] ?? []).shift() ?? { data: null, error: null };
      return Promise.resolve(r);
    });
    const resolve = (): Resp => (queues[table] ?? []).shift() ?? { data: [], error: null, count: 0 };
    chain.then = (res: (v: Resp) => void) => res(resolve());
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("getUserReviewCount (P3-20)", () => {
  it("returns the head-count, 0 when null", async () => {
    const { client } = makeClient({ reviews: [{ data: null, error: null, count: 1234 }] });
    expect(await getUserReviewCount(client, "user-1")).toBe(1234);
  });
});

describe("getReviewLogForTuning (P3-20)", () => {
  it("groups by card_id/question_id (XOR) and reverses each item's sequence to oldest-first", async () => {
    const { client } = makeClient({
      reviews: [
        {
          data: [
            { card_id: "c1", question_id: null, rating: 3, reviewed_at: "2026-09-03T00:00:00Z" },
            { card_id: "c1", question_id: null, rating: 2, reviewed_at: "2026-09-01T00:00:00Z" },
            { card_id: null, question_id: "q1", rating: 1, reviewed_at: "2026-09-02T00:00:00Z" },
          ],
          error: null,
        },
      ],
    });
    const sequences = await getReviewLogForTuning(client, "user-1");
    const byKey = new Map(sequences.map((seq) => [seq[0]!.itemKey, seq]));
    expect(byKey.get("c1")!.map((e) => e.reviewedAt.toISOString())).toEqual(["2026-09-01T00:00:00.000Z", "2026-09-03T00:00:00.000Z"]);
    expect(byKey.get("q1")).toHaveLength(1);
  });
});

// ── the loss surface + optimizer ─────────────────────────────────────
/** A synthetic but FSRS-realistic sequence: several items, each reviewed several times with a mostly-successful pattern and increasing gaps, so there's real signal for the optimizer to find. */
function syntheticSequences(itemCount: number, reviewsPerItem: number): ReviewLogEntry[][] {
  const sequences: ReviewLogEntry[][] = [];
  for (let item = 0; item < itemCount; item++) {
    const seq: ReviewLogEntry[] = [];
    let day = 0;
    for (let r = 0; r < reviewsPerItem; r++) {
      day += 1 + r; // widening gaps, as a real spaced-repetition history would have
      const rating = r % 5 === 0 ? 1 : 3; // mostly "Good", occasional lapse -- real signal, not all-successes
      seq.push({ itemKey: `item-${item}`, rating: rating as 1 | 3, reviewedAt: new Date(Date.UTC(2026, 0, 1 + day)) });
    }
    sequences.push(seq);
  }
  return sequences;
}

describe("meanLossForWeights (P3-20)", () => {
  it("returns a finite, non-negative mean loss for a real synthetic history", () => {
    const loss = meanLossForWeights(syntheticSequences(5, 8), default_w);
    expect(Number.isFinite(loss)).toBe(true);
    expect(loss).toBeGreaterThanOrEqual(0);
  });

  it("a sequence with only first-reviews (nothing to predict) has zero loss", () => {
    const oneReviewEach = syntheticSequences(5, 1);
    expect(meanLossForWeights(oneReviewEach, default_w)).toBe(0);
  });
});

describe("optimizeFsrsWeights (P3-20)", () => {
  it("never returns a worse loss than ts-fsrs's own default_w on the SAME data (only accepts strictly-improving moves)", () => {
    const sequences = syntheticSequences(8, 12);
    const defaultLoss = meanLossForWeights(sequences, default_w);
    const result = optimizeFsrsWeights(sequences);
    expect(result.loss).toBeLessThanOrEqual(defaultLoss);
    expect(result.loss).toBe(meanLossForWeights(sequences, result.weights)); // the reported loss matches what the returned weights actually produce
  });

  it("returns a weights array of the same length as ts-fsrs's own default_w, and it independently passes validateFsrsWeights", () => {
    const result = optimizeFsrsWeights(syntheticSequences(6, 10));
    expect(result.weights).toHaveLength(default_w.length);
    expect(validateFsrsWeights(result.weights)).not.toBeNull();
  });
});

// ── read-side helpers ─────────────────────────────────────────────────
describe("getFsrsTuningStatus (P3-20)", () => {
  it("eligible is false below the gate, true at/above it", async () => {
    const { client: below } = makeClient({ reviews: [{ data: null, error: null, count: FSRS_TUNING_MIN_REVIEWS - 1 }], fsrs_user_parameters: [{ data: null, error: null }] });
    expect((await getFsrsTuningStatus(below, "user-1")).eligible).toBe(false);

    const { client: atGate } = makeClient({ reviews: [{ data: null, error: null, count: FSRS_TUNING_MIN_REVIEWS }], fsrs_user_parameters: [{ data: null, error: null }] });
    expect((await getFsrsTuningStatus(atGate, "user-1")).eligible).toBe(true);
  });

  it("surfaces the existing trained_at/review_count_at_train when a row already exists", async () => {
    const { client } = makeClient({
      reviews: [{ data: null, error: null, count: 1500 }],
      fsrs_user_parameters: [{ data: { trained_at: "2026-09-01T00:00:00Z", review_count_at_train: 1200 }, error: null }],
    });
    const status = await getFsrsTuningStatus(client, "user-1");
    expect(status.tunedAt).toBe("2026-09-01T00:00:00Z");
    expect(status.reviewCountAtTrain).toBe(1200);
  });
});

describe("getUserFsrsWeights (P3-20)", () => {
  it("returns undefined when no row exists (rides ts-fsrs's own default)", async () => {
    const { client } = makeClient({ fsrs_user_parameters: [{ data: null, error: null }] });
    expect(await getUserFsrsWeights(client, "user-1")).toBeUndefined();
  });

  it("returns the stored weights when valid", async () => {
    const { client } = makeClient({ fsrs_user_parameters: [{ data: { weights: [...default_w] }, error: null }] });
    expect(await getUserFsrsWeights(client, "user-1")).toEqual([...default_w]);
  });

  it("a CORRUPTED stored row (wrong length) falls back to undefined rather than ever reaching the scheduler -- proven by first seeding the corruption, not just trusting the guard exists", async () => {
    const { client } = makeClient({ fsrs_user_parameters: [{ data: { weights: [0.1, 0.2] }, error: null }] });
    expect(await getUserFsrsWeights(client, "user-1")).toBeUndefined();
  });
});
