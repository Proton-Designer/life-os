import { describe, expect, it } from "vitest";
import { isWeeklyResetWindow, weeklyReviewRedirectTarget } from "../reset-window";

const TZ = "America/Chicago";
// 2026-10-04 is a Sunday. Chicago is UTC-5 (CDT) on these dates.
const at = (iso: string) => new Date(iso);

describe("isWeeklyResetWindow", () => {
  it.each([
    ["Saturday 23:59 local is before the window", "2026-10-04T04:59:00Z", false],
    ["Sunday 00:00 local opens it", "2026-10-04T05:00:00Z", true],
    ["Sunday evening is inside", "2026-10-05T01:00:00Z", true],
    ["Monday 11:59 local is still inside", "2026-10-05T16:59:00Z", true],
    ["Monday 12:00 local closes it", "2026-10-05T17:00:00Z", false],
    ["Wednesday is outside", "2026-10-07T17:00:00Z", false],
  ])("%s", (_name, iso, want) => {
    expect(isWeeklyResetWindow(at(iso), TZ)).toBe(want);
  });

  it("reads the LOCAL day, not UTC: Sunday 20:00 Chicago is already Monday in UTC but inside the window", () => {
    expect(isWeeklyResetWindow(at("2026-10-05T01:00:00Z"), TZ)).toBe(true);
    expect(isWeeklyResetWindow(at("2026-10-05T01:00:00Z"), "UTC")).toBe(true); // Monday 01:00 UTC
    expect(isWeeklyResetWindow(at("2026-10-05T13:00:00Z"), "UTC")).toBe(false); // Monday 13:00 UTC
    expect(isWeeklyResetWindow(at("2026-10-05T13:00:00Z"), TZ)).toBe(true); // Monday 08:00 Chicago
  });
});

describe("weeklyReviewRedirectTarget", () => {
  it("goes to /week inside the window and to the Insights Week tab otherwise", () => {
    expect(weeklyReviewRedirectTarget(at("2026-10-04T18:00:00Z"), TZ)).toBe("/week");
    expect(weeklyReviewRedirectTarget(at("2026-10-07T18:00:00Z"), TZ)).toBe("/insights?tab=week");
  });
  it("'so far' always goes to the Insights tab (the reset reviews the completed week)", () => {
    expect(weeklyReviewRedirectTarget(at("2026-10-04T18:00:00Z"), TZ, "so-far")).toBe("/insights?tab=week&view=so-far");
  });
});
