import { describe, expect, it } from "vitest";
import { shouldShowWeeklyResetCard } from "../weekly-reset-visibility";

const CHI = "America/Chicago";
const at = (l: string) => new Date(`${l}-05:00`); // CDT; Sun 2026-10-04 is a Sunday

describe("shouldShowWeeklyResetCard", () => {
  it("Sunday 00:00 through Monday 11:59 local, until a goal is set", () => {
    expect(shouldShowWeeklyResetCard(at("2026-10-03T23:59:00"), CHI, [])).toBe(false); // Saturday night
    expect(shouldShowWeeklyResetCard(at("2026-10-04T00:00:00"), CHI, [])).toBe(true);
    expect(shouldShowWeeklyResetCard(at("2026-10-05T11:59:00"), CHI, [])).toBe(true);
    expect(shouldShowWeeklyResetCard(at("2026-10-05T12:00:00"), CHI, [])).toBe(false);
    expect(shouldShowWeeklyResetCard(at("2026-10-07T10:00:00"), CHI, [])).toBe(false);
  });
  it("hides once any weekly goal has a headline (positive control: blank headlines don't hide it)", () => {
    const sunday = at("2026-10-04T10:00:00");
    expect(shouldShowWeeklyResetCard(sunday, CHI, ["  ", null, ""])).toBe(true);
    expect(shouldShowWeeklyResetCard(sunday, CHI, ["Ship the thing"])).toBe(false);
  });
  it("uses the user's zone: Sunday 01:00 in Tokyo is still Saturday in Chicago", () => {
    const instant = new Date("2026-10-04T01:00:00+09:00");
    expect(shouldShowWeeklyResetCard(instant, "Asia/Tokyo", [])).toBe(true);
    expect(shouldShowWeeklyResetCard(instant, CHI, [])).toBe(false);
  });
});
