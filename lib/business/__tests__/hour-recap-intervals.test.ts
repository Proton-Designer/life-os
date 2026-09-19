import { describe, it, expect } from "vitest";
import { mostRecentHourAsInterval } from "../hour-recap-intervals";

describe("mostRecentHourAsInterval", () => {
  it("returns no intervals when nothing has resolved yet", () => {
    expect(mostRecentHourAsInterval([], "deep_work")).toEqual([]);
  });

  it("maps the most recently resolved hour as real work when it was confirmed_business", () => {
    const resolved = [
      { hourStartIso: "2026-09-18T10:00:00.000Z", state: "confirmed_business" as const },
      { hourStartIso: "2026-09-18T11:00:00.000Z", state: "confirmed_business" as const },
    ];
    expect(mostRecentHourAsInterval(resolved, "deep_work")).toEqual([
      { domain: "deep_work", minutes: 60, isDistraction: false },
    ]);
  });

  it("maps the most recently resolved hour as a distraction when it was wasted or missed", () => {
    const resolved = [
      { hourStartIso: "2026-09-18T10:00:00.000Z", state: "confirmed_business" as const },
      { hourStartIso: "2026-09-18T11:00:00.000Z", state: "missed_wasted" as const },
    ];
    expect(mostRecentHourAsInterval(resolved, "deep_study")).toEqual([
      { domain: "deep_study", minutes: 60, isDistraction: true },
    ]);
  });

  it("always reads the LAST array entry, not the first, and never re-sorts", () => {
    // resolveSessionHours always returns its array pre-sorted oldest-first —
    // this helper trusts that ordering and just reads the last element. Fed
    // a deliberately out-of-order array here (wasted first, business last)
    // to prove that: the LAST element (business) is what wins, not the
    // chronologically-latest timestamp or the first element.
    const resolved = [
      { hourStartIso: "2026-09-18T11:00:00.000Z", state: "confirmed_wasted" as const },
      { hourStartIso: "2026-09-18T10:00:00.000Z", state: "confirmed_business" as const },
    ];
    expect(mostRecentHourAsInterval(resolved, "deep_work")[0]?.isDistraction).toBe(false);
  });
});
