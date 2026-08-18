import { describe, expect, it } from "vitest";
import { rankCityMatches, formatCoordinateLabel, formatCityLabel, nearestCityLabel, type CityRecord } from "../location";

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
