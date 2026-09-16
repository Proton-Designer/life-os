import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { default_w } from "ts-fsrs";

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

const createServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

const { runFsrsTuning, FSRS_TUNING_MIN_REVIEWS } = await import("../fsrs-tuning");

type Resp = { data: unknown; error: unknown; count?: number | null };
function makeUserClient(responses: Record<string, Resp[]>) {
  const queues: Record<string, Resp[]> = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve((queues[table] ?? []).shift() ?? { data: null, error: null }));
    const resolve = (): Resp => (queues[table] ?? []).shift() ?? { data: [], error: null, count: 0 };
    chain.then = (res: (v: Resp) => void) => res(resolve());
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

function makeServiceClient() {
  const upsertMock = vi.fn((_payload: unknown, _opts?: unknown) => Promise.resolve({ data: null, error: null }));
  const from = vi.fn(() => ({ upsert: upsertMock }));
  return { client: { from } as unknown as SupabaseClient, upsertMock };
}

/**
 * Enough reviews across enough items to genuinely exercise the optimizer
 * without taking real test time. Returned NEWEST-FIRST, matching what a
 * real `.order("reviewed_at", { ascending: false })` query returns --
 * this fake client doesn't actually sort, so the fixture itself must be
 * pre-sorted to accurately simulate production's real query behavior
 * (getReviewLogForTuning's own `.reverse()` step assumes descending input).
 */
function reviewRows(count: number): { card_id: string; question_id: null; rating: number; reviewed_at: string }[] {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ card_id: `card-${i % 20}`, question_id: null, rating: i % 5 === 0 ? 1 : 3, reviewed_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() });
  }
  return rows.reverse();
}

beforeEach(() => {
  requireUserMock.mockReset();
  createServiceRoleClientMock.mockReset();
});

describe("runFsrsTuning (P3-20)", () => {
  it("below the review gate: throws a clear message, never touches the service-role client", async () => {
    const userClient = makeUserClient({
      fsrs_user_parameters: [{ data: null, error: null }],
      reviews: [{ data: null, error: null, count: FSRS_TUNING_MIN_REVIEWS - 1 }],
    });
    requireUserMock.mockResolvedValue({ supabase: userClient, userId: "user-1" });

    await expect(runFsrsTuning()).rejects.toThrow(/Needs 1000 logged reviews/);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("within the retrain cooldown: throws a cooldown message, never re-runs the optimizer or writes", async () => {
    const recentlyTrained = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago, well inside the 24h cooldown
    const userClient = makeUserClient({ fsrs_user_parameters: [{ data: { trained_at: recentlyTrained }, error: null }] });
    requireUserMock.mockResolvedValue({ supabase: userClient, userId: "user-1" });

    await expect(runFsrsTuning()).rejects.toThrow(/try again in about/i);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("a cooldown that has fully elapsed does not block a retrain", async () => {
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago, past the 24h cooldown
    const { client: serviceClient, upsertMock } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(serviceClient);
    const userClient = makeUserClient({
      fsrs_user_parameters: [{ data: { trained_at: longAgo }, error: null }],
      reviews: [{ data: null, error: null, count: FSRS_TUNING_MIN_REVIEWS }, { data: reviewRows(FSRS_TUNING_MIN_REVIEWS), error: null }],
    });
    requireUserMock.mockResolvedValue({ supabase: userClient, userId: "user-1" });

    const result = await runFsrsTuning();
    expect(result.reviewCount).toBe(FSRS_TUNING_MIN_REVIEWS);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  }, 20000);

  it("happy path: derives user_id ONLY from requireUser (never a caller argument -- runFsrsTuning takes none), writes via the service-role client with validated weights, correct review count, and a real loss", async () => {
    const { client: serviceClient, upsertMock } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(serviceClient);
    const userClient = makeUserClient({
      fsrs_user_parameters: [{ data: null, error: null }],
      reviews: [{ data: null, error: null, count: FSRS_TUNING_MIN_REVIEWS }, { data: reviewRows(FSRS_TUNING_MIN_REVIEWS), error: null }],
    });
    requireUserMock.mockResolvedValue({ supabase: userClient, userId: "user-42" });

    const result = await runFsrsTuning();

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const payload = upsertMock.mock.calls[0]![0] as { user_id: string; weights: number[]; review_count_at_train: number; loss: number };
    expect(payload.user_id).toBe("user-42"); // came from requireUser's resolved identity, not any argument this function accepts
    expect(payload.weights).toHaveLength(default_w.length);
    expect(payload.review_count_at_train).toBe(FSRS_TUNING_MIN_REVIEWS);
    expect(Number.isFinite(payload.loss)).toBe(true);
    expect(result.weights).toEqual(payload.weights);
  }, 20000);

  it("a review count above the gate but zero actual review rows (an inconsistent DB state) still produces a valid result rather than crashing", async () => {
    const { client: serviceClient, upsertMock } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(serviceClient);
    const userClient = makeUserClient({
      fsrs_user_parameters: [{ data: null, error: null }],
      reviews: [{ data: null, error: null, count: FSRS_TUNING_MIN_REVIEWS }, { data: [], error: null }],
    });
    requireUserMock.mockResolvedValue({ supabase: userClient, userId: "user-1" });

    const result = await runFsrsTuning();
    expect(result.weights).toEqual([...default_w]);
    expect(result.loss).toBe(0);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  }, 20000);
});
