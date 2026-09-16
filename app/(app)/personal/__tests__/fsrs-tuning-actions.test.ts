import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

const getFsrsTuningStatusCoreMock = vi.fn();
const runFsrsTuningMock = vi.fn();
vi.mock("@/lib/self-mastery/fsrs-tuning", () => ({
  getFsrsTuningStatus: (...args: unknown[]) => getFsrsTuningStatusCoreMock(...args),
  runFsrsTuning: (...args: unknown[]) => runFsrsTuningMock(...args),
  FSRS_TUNING_MIN_REVIEWS: 1000,
}));

const { getFsrsTuningStatus, triggerFsrsTuning } = await import("../fsrs-tuning-actions");

beforeEach(() => {
  requireUserMock.mockReset();
  getFsrsTuningStatusCoreMock.mockReset();
  runFsrsTuningMock.mockReset();
});

describe("getFsrsTuningStatus Server Action (P3-20)", () => {
  it("resolves the caller via requireUser and passes that userId through, never a client-supplied one (this action takes no arguments at all)", async () => {
    requireUserMock.mockResolvedValue({ supabase: "fake-client", userId: "user-1" });
    getFsrsTuningStatusCoreMock.mockResolvedValue({ reviewCount: 500, eligible: false, tunedAt: null, reviewCountAtTrain: null });

    const status = await getFsrsTuningStatus();

    expect(getFsrsTuningStatusCoreMock).toHaveBeenCalledWith("fake-client", "user-1");
    expect(status.reviewCount).toBe(500);
  });
});

describe("triggerFsrsTuning Server Action (P3-20)", () => {
  it("returns ok:true with a review-count message on success", async () => {
    runFsrsTuningMock.mockResolvedValue({ weights: [], loss: 0.1, reviewCount: 1200 });
    const res = await triggerFsrsTuning();
    expect(res).toEqual({ ok: true, message: "Tuned on 1200 reviews." });
  });

  it("turns a thrown gate/cooldown error into ok:false with the thrown message, never lets it surface as an unhandled rejection", async () => {
    runFsrsTuningMock.mockRejectedValue(new Error("Needs 1000 logged reviews to tune (you have 500)."));
    const res = await triggerFsrsTuning();
    expect(res).toEqual({ ok: false, message: "Needs 1000 logged reviews to tune (you have 500)." });
  });

  it("a non-Error rejection still returns a safe, generic message rather than crashing", async () => {
    runFsrsTuningMock.mockRejectedValue("weird rejection");
    const res = await triggerFsrsTuning();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/unexpectedly/i);
  });
});
