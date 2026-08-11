import { describe, expect, it, vi, beforeEach } from "vitest";

const getProfileMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  getProfile: () => getProfileMock(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: vi.fn() })),
}));

describe("defaultDataSource().getProfile", () => {
  beforeEach(() => {
    getProfileMock.mockReset();
  });

  it("routes through the shared cached getProfile() instead of its own raw query", async () => {
    getProfileMock.mockResolvedValue({
      location_lat: 41.8781,
      location_lng: -87.6298,
      timezone: "America/Chicago",
      prayer_calc_method: "MWL",
      asr_madhab: "standard",
      // Extra full-row fields the narrower HomeProfile type doesn't need —
      // confirms the result is narrowed, not just passed through raw.
      onboarding_completed: true,
      pin_hash: "should-never-appear-in-the-result",
    });

    const { defaultDataSource } = await import("../get-priority-items");
    const result = await defaultDataSource().getProfile("user-1");

    expect(getProfileMock).toHaveBeenCalled();
    expect(result).toEqual({
      location_lat: 41.8781,
      location_lng: -87.6298,
      timezone: "America/Chicago",
      prayer_calc_method: "MWL",
      asr_madhab: "standard",
    });
    expect(result).not.toHaveProperty("pin_hash");
  });

  it("returns null when the shared getProfile() returns null", async () => {
    getProfileMock.mockResolvedValue(null);

    const { defaultDataSource } = await import("../get-priority-items");
    const result = await defaultDataSource().getProfile("user-1");

    expect(result).toBeNull();
  });
});
