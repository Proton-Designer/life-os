import { describe, expect, it } from "vitest";
import { groupCompletedTasksByWeek } from "../completed-by-week";

function task(id: string, completedAt: string) {
  return { id, title: `Task ${id}`, meta: "—", completedAt };
}

describe("groupCompletedTasksByWeek", () => {
  it("groups items by their LOCAL week, most recent week first", () => {
    const groups = groupCompletedTasksByWeek(
      [
        task("older", "2026-08-10T18:00:00.000Z"), // week of Aug 9
        task("newer", "2026-08-17T18:00:00.000Z"), // week of Aug 16
      ],
      "America/Chicago"
    );
    expect(groups.map((g) => g.weekStart)).toEqual(["2026-08-16", "2026-08-09"]);
  });

  it("orders items within a week by completion time, oldest first", () => {
    const groups = groupCompletedTasksByWeek(
      [task("second", "2026-08-11T20:00:00.000Z"), task("first", "2026-08-10T15:00:00.000Z")],
      "America/Chicago"
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["first", "second"]);
  });

  // AGENTS.md: a calendar date/week is a function of an instant AND a
  // timezone. Two instants either side of the UTC midnight rollover, both
  // still the same LOCAL evening, must land in the same week — this exact
  // bug class shipped three times in one night on 2026-08-24.
  it("agrees on the week for 18:59 and 19:01 America/Chicago on the same local evening, despite crossing UTC midnight", () => {
    // 2026-08-24 is CDT (UTC-5). 18:59 local = 23:59 UTC same day;
    // 19:01 local = 00:01 UTC the NEXT day — different UTC dates, same
    // Chicago date (Monday Aug 24, week of Sunday Aug 23).
    const groups = groupCompletedTasksByWeek(
      [task("early", "2026-08-24T23:59:00.000Z"), task("late", "2026-08-25T00:01:00.000Z")],
      "America/Chicago"
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].weekStart).toBe("2026-08-23");
  });

  it("resolves the local date correctly for a timezone EAST of UTC, where the local date is already ahead", () => {
    // 2026-08-24T20:00:00Z is 2026-08-25T05:00:00+09:00 in Tokyo — the
    // local calendar date is already the next day relative to UTC's.
    const groups = groupCompletedTasksByWeek([task("tokyo", "2026-08-24T20:00:00.000Z")], "Asia/Tokyo");
    // 2026-08-25 is a Tuesday; week start is Sunday 2026-08-23.
    expect(groups[0].weekStart).toBe("2026-08-23");
  });

  it("labels a week as 'Week of <month day>' from its Sunday", () => {
    const groups = groupCompletedTasksByWeek([task("t1", "2026-08-17T18:00:00.000Z")], "America/Chicago");
    expect(groups[0].weekLabel).toBe("Week of Aug 16");
  });

  it("returns no groups for no completed tasks", () => {
    expect(groupCompletedTasksByWeek([], "America/Chicago")).toEqual([]);
  });
});
