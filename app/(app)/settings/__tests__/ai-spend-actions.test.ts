import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const requireUserMock = vi.fn(async () => ({ supabase: {} as unknown as SupabaseClient, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

const resolveMonthlySpendCapContextMock = vi.fn();
const monthlySpendUsdForUserMock = vi.fn();
vi.mock("@/lib/ai/monthly-spend-cap", () => ({
  DEFAULT_MONTHLY_SPEND_CAP_USD: 10,
  monthWindowUtc: () => ({
    startUtc: new Date("2026-09-01T00:00:00Z"),
    endUtc: new Date("2026-10-01T00:00:00Z"),
    monthKey: "2026-09",
  }),
  resolveMonthlySpendCapContext: (...args: unknown[]) => resolveMonthlySpendCapContextMock(...args),
}));
vi.mock("@/lib/ai/usage-log", () => ({
  getDefaultUsageStore: () => ({ monthlySpendUsdForUser: (...args: unknown[]) => monthlySpendUsdForUserMock(...args) }),
}));

const updateProfileMock = vi.fn();
vi.mock("../actions", () => ({
  updateProfile: (...args: unknown[]) => updateProfileMock(...args),
}));

const { getMyMonthlySpendStatus, saveMyMonthlySpendCapUsd } = await import("../ai-spend-actions");

describe("getMyMonthlySpendStatus", () => {
  beforeEach(() => {
    requireUserMock.mockClear();
    resolveMonthlySpendCapContextMock.mockReset();
    monthlySpendUsdForUserMock.mockReset();
  });

  it("returns the resolved timezone's cap and month-to-date spend", async () => {
    resolveMonthlySpendCapContextMock.mockResolvedValue({ ok: true, timezone: "America/Chicago", capUsd: 25 });
    monthlySpendUsdForUserMock.mockResolvedValue(3.5);

    const status = await getMyMonthlySpendStatus();

    expect(status).toEqual({ spentUsd: 3.5, capUsd: 25, monthKey: "2026-09" });
    expect(monthlySpendUsdForUserMock).toHaveBeenCalledWith("user-1", new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
  });

  it("a context resolution FAILURE degrades to UTC/default for DISPLAY -- does not fail closed the way gatewayChat's own check does", async () => {
    resolveMonthlySpendCapContextMock.mockResolvedValue({ ok: false, reason: "connection reset" });
    monthlySpendUsdForUserMock.mockResolvedValue(0);

    const status = await getMyMonthlySpendStatus();

    expect(status.capUsd).toBe(10); // DEFAULT_MONTHLY_SPEND_CAP_USD
  });

  it("an unreadable usage log (Infinity, the store's own fail-closed value) shows as null, never a fabricated $0", async () => {
    resolveMonthlySpendCapContextMock.mockResolvedValue({ ok: true, timezone: "UTC", capUsd: 10 });
    monthlySpendUsdForUserMock.mockResolvedValue(Number.POSITIVE_INFINITY);

    const status = await getMyMonthlySpendStatus();

    expect(status.spentUsd).toBeNull();
  });
});

describe("saveMyMonthlySpendCapUsd", () => {
  beforeEach(() => {
    updateProfileMock.mockReset();
  });

  it("writes the given cap through updateProfile and reports success", async () => {
    updateProfileMock.mockResolvedValue(undefined);
    const result = await saveMyMonthlySpendCapUsd(30);
    expect(updateProfileMock).toHaveBeenCalledWith({ ai_monthly_spend_cap_usd: 30 });
    expect(result.ok).toBe(true);
  });

  it("null reverts to the system default and says so", async () => {
    updateProfileMock.mockResolvedValue(undefined);
    const result = await saveMyMonthlySpendCapUsd(null);
    expect(updateProfileMock).toHaveBeenCalledWith({ ai_monthly_spend_cap_usd: null });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("10.00");
  });

  it("a thrown validation error from updateProfile (e.g. non-positive cap) surfaces as ok:false, not an unhandled rejection", async () => {
    updateProfileMock.mockRejectedValue(new Error("ai_monthly_spend_cap_usd must be a positive number, or null to use the default."));
    const result = await saveMyMonthlySpendCapUsd(-5);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("positive number");
  });
});
