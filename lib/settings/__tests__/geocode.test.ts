import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGeocodedCities } from "../geocode";

describe("fetchGeocodedCities", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("maps a successful response into CityRecord shape", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            name: "McKinney",
            latitude: 33.19762,
            longitude: -96.61527,
            country: "United States",
            admin1: "Texas",
            timezone: "America/Chicago",
            population: 162898,
          },
        ],
      }),
    });

    const result = await fetchGeocodedCities("McKinney");
    expect(result).toEqual([
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
  });

  it("defaults population to 0 when the API omits it", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ name: "Small Town", latitude: 1, longitude: 2, country: "US", timezone: "UTC" }],
      }),
    });
    const result = await fetchGeocodedCities("Small Town");
    expect(result?.[0].pop).toBe(0);
  });

  it("returns an empty array (not null) for a legitimate zero-match response", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await fetchGeocodedCities("Zzznotacityxyz");
    expect(result).toEqual([]);
  });

  it("returns null on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const result = await fetchGeocodedCities("McKinney");
    expect(result).toBeNull();
  });

  it("returns null on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const result = await fetchGeocodedCities("McKinney");
    expect(result).toBeNull();
  });

  it("aborts and returns null when the request hangs past the timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );

    const resultPromise = fetchGeocodedCities("McKinney");
    await vi.advanceTimersByTimeAsync(2500);
    const result = await resultPromise;
    expect(result).toBeNull();
  });
});
