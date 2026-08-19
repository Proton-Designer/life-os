import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(async () => ({ supabase: {}, userId: "user-1" })),
}));

describe("searchCities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression: city-timezones' bundled dataset doesn't include McKinney,
  // TX (~207k pop) at all — confirmed via a direct dataset scan, not a
  // matching-logic bug. See lib/settings/supplemental-cities.ts.
  it("finds a supplemental city missing from the bundled dataset", async () => {
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("McKinney");
    expect(result).toContainEqual(
      expect.objectContaining({ city: "McKinney", province: "Texas", country: "United States of America" })
    );
  });

  it("finds a supplemental city via a 'city, state' style query", async () => {
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("McKinney TX");
    expect(result.some((c) => c.city === "McKinney")).toBe(true);
  });

  it("still finds cities from the underlying bundled dataset", async () => {
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("Chicago");
    expect(result.some((c) => c.city === "Chicago")).toBe(true);
  });

  it("returns no matches for a nonsense query", async () => {
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("Zzzznotacityxyz");
    expect(result).toEqual([]);
  });
});
