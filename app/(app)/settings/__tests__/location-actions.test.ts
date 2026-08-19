import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(async () => ({ supabase: {}, userId: "user-1" })),
}));

const fetchGeocodedCitiesMock = vi.fn();
vi.mock("@/lib/settings/geocode", () => ({
  fetchGeocodedCities: (...args: unknown[]) => fetchGeocodedCitiesMock(...args),
}));

describe("searchCities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the geocoding API "didn't answer" — every test below that
    // doesn't care about the geocoded path exercises the local-only
    // fallback exactly as it behaved before this file existed, with no
    // network call made from a unit test.
    fetchGeocodedCitiesMock.mockResolvedValue(null);
  });

  // Regression: city-timezones' bundled dataset doesn't include McKinney,
  // TX (~207k pop) at all — confirmed via a direct dataset scan, not a
  // matching-logic bug. See lib/settings/supplemental-cities.ts.
  it("finds a supplemental city missing from the bundled dataset when the API doesn't answer", async () => {
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

  it("returns no matches for a nonsense query when neither source has it", async () => {
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("Zzzznotacityxyz");
    expect(result).toEqual([]);
  });

  it("prefers the geocoded result when the API answers", async () => {
    fetchGeocodedCitiesMock.mockResolvedValue([
      {
        city: "McKinney",
        province: "Texas",
        country: "United States",
        lat: 33.19762,
        lng: -96.61527,
        pop: 162898,
        timezone: "America/Chicago",
      },
    ]);
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("McKinney");
    // One result, not two — deduped against the supplemental-cities entry
    // for the same real city, and the geocoded record (country: "United
    // States") is the one that won.
    expect(result).toHaveLength(1);
    expect(result[0].city).toBe("McKinney");
    expect(result[0].country).toBe("United States"); // not "United States of America" (the local record)
  });

  it("surfaces a geocoded city the bundled dataset has never had, e.g. Prosper TX", async () => {
    fetchGeocodedCitiesMock.mockResolvedValue([
      {
        city: "Prosper",
        province: "Texas",
        country: "United States",
        lat: 33.2362,
        lng: -96.8011,
        pop: 30174,
        timezone: "America/Chicago",
      },
    ]);
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("Prosper");
    expect(result.some((c) => c.city === "Prosper")).toBe(true);
  });

  it("still returns local-dataset matches alongside a geocoded answer that has zero results", async () => {
    fetchGeocodedCitiesMock.mockResolvedValue([]); // API answered, legitimately found nothing
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("Chicago");
    expect(result.some((c) => c.city === "Chicago")).toBe(true);
  });

  it("falls back to the bundled dataset when the geocoding API times out or errors", async () => {
    fetchGeocodedCitiesMock.mockResolvedValue(null);
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("Denton");
    expect(result.some((c) => c.city === "Denton")).toBe(true);
  });
});

// The block above mocks the whole geocode module, which is the right level
// for testing searchCities' own merge/dedupe logic. This block instead
// proves the fallback end to end through the REAL, unmocked geocode.ts —
// only global.fetch (the actual network dependency) is faked, at the lowest
// layer available without a live DNS/firewall block (not possible in this
// sandbox; see the verification report). This is the strongest proof
// available here that a genuinely broken network still leaves the form
// working, not just that searchCities' own branching logic is correct.
describe("searchCities — real geocode.ts, only fetch faked", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/settings/geocode");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("still resolves a supplemental city when the network call rejects outright", async () => {
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND geocoding-api.open-meteo.com"));
    const { searchCities } = await import("../location-actions");
    const result = await searchCities("McKinney");
    expect(result).toContainEqual(expect.objectContaining({ city: "McKinney", province: "Texas" }));
  });

  it("still resolves a bundled-dataset city when the request hangs past the ~2.5s timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    const { searchCities } = await import("../location-actions");
    const resultPromise = searchCities("Denton");
    await vi.advanceTimersByTimeAsync(2500);
    const result = await resultPromise;
    expect(result.some((c) => c.city === "Denton")).toBe(true);
  });
});
