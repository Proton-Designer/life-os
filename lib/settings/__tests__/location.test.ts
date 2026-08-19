import { describe, expect, it } from "vitest";
import {
  rankCityMatches,
  combineCitySources,
  formatCoordinateLabel,
  formatCityLabel,
  nearestCityLabel,
  type CityRecord,
} from "../location";

function city(overrides: Partial<CityRecord> & Pick<CityRecord, "city" | "pop">): CityRecord {
  return {
    province: "",
    country: "Testland",
    lat: 0,
    lng: 0,
    timezone: "UTC",
    ...overrides,
  };
}

describe("rankCityMatches", () => {
  it("returns empty output when both exact and fallback matches are empty", () => {
    expect(rankCityMatches([], [])).toEqual([]);
  });

  it("prefers exact matches over fallback matches when exact matches exist", () => {
    const exact = [city({ city: "Chicago", pop: 5_000_000 })];
    const fallback = [city({ city: "Some Village", pop: 100 })];
    const result = rankCityMatches(exact, fallback);
    expect(result).toEqual([
      { city: "Chicago", province: "", country: "Testland", lat: 0, lng: 0, timezone: "UTC" },
    ]);
  });

  it("falls back to the broader search when there are no exact matches", () => {
    const fallback = [city({ city: "Springfield", pop: 100_000 })];
    const result = rankCityMatches([], fallback);
    expect(result.map((r) => r.city)).toEqual(["Springfield"]);
  });

  it("drops entries with no known timezone in the dataset", () => {
    const exact = [
      city({ city: "Known", pop: 1000, timezone: "America/Chicago" }),
      city({ city: "Unknown", pop: 5000, timezone: null }),
    ];
    const result = rankCityMatches(exact, []);
    expect(result.map((r) => r.city)).toEqual(["Known"]);
  });

  it("sorts by population descending, most likely intended city first", () => {
    const exact = [
      city({ city: "Small", pop: 500 }),
      city({ city: "Big", pop: 8_000_000 }),
      city({ city: "Medium", pop: 200_000 }),
    ];
    const result = rankCityMatches(exact, []);
    expect(result.map((r) => r.city)).toEqual(["Big", "Medium", "Small"]);
  });

  it("caps results at 8", () => {
    const exact = Array.from({ length: 20 }, (_, i) => city({ city: `City${i}`, pop: i }));
    const result = rankCityMatches(exact, []);
    expect(result).toHaveLength(8);
  });

  it("drops the population field from the returned shape", () => {
    const exact = [city({ city: "Chicago", pop: 5_000_000 })];
    const result = rankCityMatches(exact, []);
    expect(result[0]).not.toHaveProperty("pop");
  });
});

describe("combineCitySources", () => {
  it("returns geocoded and local results together when they don't overlap", () => {
    const geocoded = [city({ city: "McKinney", province: "Texas", pop: 207_000, lat: 33.1976, lng: -96.6398 })];
    const local = [city({ city: "Denton", province: "Texas", pop: 138_000, lat: 33.2148, lng: -97.1331 })];
    const result = combineCitySources(geocoded, local);
    expect(result.map((r) => r.city)).toEqual(["McKinney", "Denton"]);
  });

  it("dedupes the same real city across sources, preferring the geocoded record", () => {
    // Same city, ~2km apart (rounds to the same key) and different country
    // string formatting between sources — exactly the McKinney case.
    const geocoded = [
      city({ city: "McKinney", province: "Texas", country: "United States", pop: 162_898, lat: 33.19762, lng: -96.61527 }),
    ];
    const local = [
      city({ city: "McKinney", province: "Texas", country: "United States of America", pop: 207_088, lat: 33.1972, lng: -96.6398 }),
    ];
    const result = combineCitySources(geocoded, local);
    expect(result).toHaveLength(1);
    expect(result[0].country).toBe("United States"); // the geocoded record won
  });

  it("does not dedupe two distinct cities that merely share a name", () => {
    const geocoded = [city({ city: "Springfield", province: "Illinois", pop: 100_000, lat: 39.78, lng: -89.65 })];
    const local = [city({ city: "Springfield", province: "Missouri", pop: 180_000, lat: 37.18, lng: -93.32 })];
    const result = combineCitySources(geocoded, local);
    expect(result).toHaveLength(2);
  });

  it("drops entries with no known timezone from either source", () => {
    const geocoded = [city({ city: "Known", pop: 1000, timezone: "America/Chicago" })];
    const local = [city({ city: "Unknown", pop: 5000, timezone: null })];
    const result = combineCitySources(geocoded, local);
    expect(result.map((r) => r.city)).toEqual(["Known"]);
  });

  it("preserves the geocoded source's own relevance order rather than re-sorting by population", () => {
    // The actual bug this locks in: Open-Meteo ranks "Anna" name-matches
    // ahead of "Annaba," a much bigger city that only partially matches.
    // Sorting the merged list by population would undo that and bury every
    // real "Anna" result under the unrelated big one.
    const geocoded = [
      city({ city: "Anna", province: "Valencia", country: "Spain", pop: 2_775, lat: 39.02, lng: -0.65 }),
      city({ city: "Anna", province: "Voronezh Oblast", country: "Russia", pop: 19_148, lat: 51.49, lng: 40.42 }),
      city({ city: "Anna", province: "Texas", country: "United States", pop: 11_463, lat: 33.35, lng: -96.55 }),
      city({ city: "Annaba", province: "Annaba", country: "Algeria", pop: 342_703, lat: 36.9, lng: 7.77 }),
    ];
    const result = combineCitySources(geocoded, []);
    expect(result.map((r) => r.city)).toEqual(["Anna", "Anna", "Anna", "Annaba"]);
  });

  it("caps the merged list at 8, geocoded results first", () => {
    const geocoded = Array.from({ length: 5 }, (_, i) => city({ city: `Geo${i}`, pop: 0, lat: i, lng: i }));
    const local = Array.from({ length: 5 }, (_, i) => city({ city: `Local${i}`, pop: 0, lat: i + 100, lng: i + 100 }));
    const result = combineCitySources(geocoded, local);
    expect(result).toHaveLength(8);
    expect(result.map((r) => r.city)).toEqual(["Geo0", "Geo1", "Geo2", "Geo3", "Geo4", "Local0", "Local1", "Local2"]);
  });
});

describe("formatCoordinateLabel", () => {
  it("formats a northeast coordinate", () => {
    expect(formatCoordinateLabel(41.8300, 87.7501)).toBe("41.8300°N, 87.7501°E");
  });

  it("formats a northwest coordinate (the common case — most cities are west of the prime meridian)", () => {
    expect(formatCoordinateLabel(41.8300, -87.7501)).toBe("41.8300°N, 87.7501°W");
  });

  it("formats a southwest coordinate", () => {
    expect(formatCoordinateLabel(-33.8688, 151.2093)).toBe("33.8688°S, 151.2093°E");
  });

  it("rounds to 4 decimal places", () => {
    expect(formatCoordinateLabel(41.829990661234, -87.750054971234)).toBe("41.8300°N, 87.7501°W");
  });
});

describe("formatCityLabel", () => {
  it("includes the province when present", () => {
    expect(formatCityLabel({ city: "Chicago", province: "Illinois", country: "United States of America" })).toBe(
      "Chicago, Illinois, United States of America"
    );
  });

  it("omits the province when it's empty", () => {
    expect(formatCityLabel({ city: "Some City", province: "", country: "Testland" })).toBe("Some City, Testland");
  });
});

describe("nearestCityLabel", () => {
  const CHICAGO = city({ city: "Chicago", province: "Illinois", country: "United States of America", pop: 5_000_000, lat: 41.8300, lng: -87.7501 });
  const LONDON = city({ city: "London", province: "Westminster", country: "United Kingdom", pop: 8_000_000, lat: 51.5, lng: -0.1167 });

  it("returns null for an empty city list", () => {
    expect(nearestCityLabel(41.83, -87.75, [])).toBeNull();
  });

  it("returns the label of the nearest city when within the threshold", () => {
    expect(nearestCityLabel(41.8305, -87.7495, [CHICAGO, LONDON])).toBe("Chicago, Illinois, United States of America");
  });

  it("picks the nearer of two candidates, not just the first in the list", () => {
    expect(nearestCityLabel(51.5, -0.1167, [CHICAGO, LONDON])).toBe("London, Westminster, United Kingdom");
  });

  it("returns null when the nearest city is beyond the distance threshold (mid-ocean, coarse dataset)", () => {
    // Roughly mid-Atlantic — nowhere near either city.
    expect(nearestCityLabel(35, -40, [CHICAGO, LONDON])).toBeNull();
  });

  it("respects a custom distance threshold", () => {
    // ~0.9km from Chicago's listed point — within a generous threshold, outside a tight one.
    expect(nearestCityLabel(41.8380, -87.7501, [CHICAGO, LONDON], 5)).toBe("Chicago, Illinois, United States of America");
    expect(nearestCityLabel(41.8380, -87.7501, [CHICAGO, LONDON], 0.1)).toBeNull();
  });
});
