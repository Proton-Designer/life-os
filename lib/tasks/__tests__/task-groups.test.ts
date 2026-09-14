import { describe, expect, it } from "vitest";
import { bucketTaskGroup, groupTasksByBucket, splitByWeek, deadlineWindow, UPCOMING_WINDOW_DAYS, TASK_GROUP_ORDER, TASK_GROUP_LABEL } from "../task-groups";
import { getWeekStartDate, weekDatesFrom, addDaysToDateString } from "@/lib/date-utils";

const TODAY = "2026-08-25"; // Tuesday
const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];
const NEXT_WEEK_DATES = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const HORIZON = "2026-09-24"; // TODAY + 30 days

const bucket = (due: string | null, today = TODAY, week = WEEK_DATES, nextWeek = NEXT_WEEK_DATES, horizon = HORIZON) =>
  bucketTaskGroup(due, today, week, nextWeek, horizon);

describe("bucketTaskGroup", () => {
  it("buckets today into Due Soon", () => {
    expect(bucket(TODAY)).toBe("dueSoon");
  });

  it("buckets another day in this week's Sun-Sat range into Due Soon", () => {
    expect(bucket("2026-08-29")).toBe("dueSoon");
  });

  it("buckets a day in NEXT week's Sun-Sat range into Due Soon too — the range is now two weeks", () => {
    expect(bucket("2026-08-30")).toBe("dueSoon");
    expect(bucket("2026-09-05")).toBe("dueSoon");
  });

  it("buckets an earlier day of this week (already overdue) into Overdue, not Due Soon", () => {
    expect(bucket("2026-08-23")).toBe("overdue");
  });

  it("buckets yesterday into Overdue", () => {
    expect(bucket("2026-08-24")).toBe("overdue");
  });

  it("does not treat today itself as overdue", () => {
    expect(bucket(TODAY)).not.toBe("overdue");
    expect(bucket(TODAY)).toBe("dueSoon");
  });

  it("buckets a date beyond the two-week Due Soon range but inside 30 days into Upcoming", () => {
    expect(bucket("2026-09-10")).toBe("next30");
  });

  it("includes the 30th day itself in Upcoming, and excludes the 31st", () => {
    expect(bucket("2026-09-24")).toBe("next30");
    expect(bucket("2026-09-25")).toBe("future");
  });

  it("buckets a null due date as Future", () => {
    expect(bucket(null)).toBe("future");
  });

  describe("Upcoming is a rolling 30 days, not a calendar month", () => {
    it("keeps a date in the NEXT calendar month inside the window", () => {
      expect(bucket("2026-09-10")).toBe("next30");
    });

    it("does not empty out at the end of a month", () => {
      const eom = "2026-08-31";
      const eomWeek = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
      const eomNextWeek = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"];
      expect(bucketTaskGroup("2026-09-20", eom, eomWeek, eomNextWeek, "2026-09-30")).toBe("next30");
    });
  });

  describe("overdue work always lands in Overdue, not Upcoming or Future", () => {
    it("puts a task overdue from before this week into Overdue, not Upcoming", () => {
      expect(bucket("2026-08-10")).toBe("overdue");
    });

    it("puts a task overdue from a previous calendar month there too, no matter how old", () => {
      expect(bucket("2026-07-30")).toBe("overdue");
    });
  });

  // Reversed 2026-09-10 batch 2 (Ayman: Due Soon now spans two full calendar
  // weeks): the old "tomorrow always outranks the week boundary" special
  // case is gone because it's now structurally impossible for tomorrow to
  // fall outside week+nextWeek — on Saturday, tomorrow is Sunday, which IS
  // next week's first day.
  describe("the two-week range makes a separate tomorrow rule unnecessary", () => {
    it("a Saturday's tomorrow (next week's Sunday) is still Due Soon, with no special case needed", () => {
      const SATURDAY = "2026-08-29";
      expect(bucketTaskGroup("2026-08-30", SATURDAY, WEEK_DATES, NEXT_WEEK_DATES, "2026-09-28")).toBe("dueSoon");
    });

    it("the day after next week ends is Upcoming, not Due Soon", () => {
      expect(bucket("2026-09-06")).toBe("next30");
    });
  });
});

describe("groupTasksByBucket", () => {
  it("sorts each bucket soonest-first, with null due dates last", () => {
    const tasks = [
      { id: "later-week", dueDate: "2026-08-28" },
      { id: "today", dueDate: TODAY },
      { id: "no-date", dueDate: null },
      { id: "next-week", dueDate: "2026-08-31" },
      { id: "upcoming", dueDate: "2026-09-15" },
      { id: "far", dueDate: "2027-01-01" },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, WEEK_DATES, NEXT_WEEK_DATES, HORIZON);

    expect(groups.dueSoon.map((t) => t.id)).toEqual(["today", "later-week", "next-week"]);
    expect(groups.next30.map((t) => t.id)).toEqual(["upcoming"]);
    expect(groups.future.map((t) => t.id)).toEqual(["far", "no-date"]);
  });

  it("sorts the overdue bucket oldest-first too, even though nothing renders it today", () => {
    const tasks = [
      { id: "week-and-half-ago", dueDate: "2026-08-16" },
      { id: "yesterday", dueDate: "2026-08-24" },
      { id: "three-weeks-ago", dueDate: "2026-08-04" },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, WEEK_DATES, NEXT_WEEK_DATES, HORIZON);
    expect(groups.overdue.map((t) => t.id)).toEqual(["three-weeks-ago", "week-and-half-ago", "yesterday"]);
  });

  it("returns all four bucket keys even when empty, not just the rendered three", () => {
    const groups = groupTasksByBucket([], TODAY, WEEK_DATES, NEXT_WEEK_DATES, HORIZON);
    expect(Object.keys(groups).sort()).toEqual(["dueSoon", "future", "next30", "overdue"]);
  });

  it("TASK_GROUP_ORDER is every bucket key except overdue", () => {
    const groups = groupTasksByBucket([], TODAY, WEEK_DATES, NEXT_WEEK_DATES, HORIZON);
    const allKeys = Object.keys(groups).sort();
    const missing = allKeys.filter((k) => !TASK_GROUP_ORDER.includes(k as never));
    expect(missing).toEqual(["overdue"]);
  });

  it("loses no task — every input task appears in exactly one of the four buckets", () => {
    const tasks = [
      { id: "overdue-old", dueDate: "2026-07-01" },
      { id: "overdue-this-week", dueDate: "2026-08-23" },
      { id: "today", dueDate: TODAY },
      { id: "next-week", dueDate: "2026-09-01" },
      { id: "later-week", dueDate: "2026-08-28" },
      { id: "upcoming", dueDate: "2026-09-15" },
      { id: "far-future", dueDate: "2027-01-01" },
      { id: "no-date", dueDate: null },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, WEEK_DATES, NEXT_WEEK_DATES, HORIZON);
    const union = [...groups.overdue, ...groups.dueSoon, ...groups.next30, ...groups.future].map((t) => t.id).sort();
    expect(union).toEqual(tasks.map((t) => t.id).sort());
  });
});

describe("splitByWeek", () => {
  const dueSoonTasks = [
    { id: "today", dueDate: TODAY },
    { id: "friday", dueDate: "2026-08-28" },
    { id: "next-sun", dueDate: "2026-08-30" },
    { id: "next-fri", dueDate: "2026-09-04" },
  ];

  it("puts this calendar week's tasks in thisWeek, in arrival (soonest-first) order", () => {
    const { thisWeek } = splitByWeek(dueSoonTasks, WEEK_DATES);
    expect(thisWeek.map((t) => t.id)).toEqual(["today", "friday"]);
  });

  it("puts everything else — next week's tasks — in nextWeek, order preserved", () => {
    const { nextWeek } = splitByWeek(dueSoonTasks, WEEK_DATES);
    expect(nextWeek.map((t) => t.id)).toEqual(["next-sun", "next-fri"]);
  });

  it("splits nothing when Due Soon is empty", () => {
    expect(splitByWeek([], WEEK_DATES)).toEqual({ thisWeek: [], nextWeek: [] });
  });

  it("loses no task — every Due Soon item lands in exactly one half", () => {
    const { thisWeek, nextWeek } = splitByWeek(dueSoonTasks, WEEK_DATES);
    expect([...thisWeek, ...nextWeek].map((t) => t.id).sort()).toEqual(dueSoonTasks.map((t) => t.id).sort());
  });
});

// #51 (Opus Lead-verified by arithmetic, 2026-09-14): the OLD horizon formula
// (addDaysToDateString(todayStr, UPCOMING_WINDOW_DAYS)) anchored "Upcoming"'s end to
// TODAY, but bucketTaskGroup's Due Soon exclusion ends at nextWeekDates' own last day
// (weekStart + 13), where weekStart moves relative to today depending on the weekday —
// so "Upcoming"'s actual width was 17 + dayOfWeek days (17 on Sunday, 23 on Saturday),
// never the constant 30 its own doc comment promised. deadlineWindow fixes this by
// anchoring the horizon to the END of Due Soon instead of to today.
describe("deadlineWindow — #51 fix: a constant-width Upcoming bucket on every weekday", () => {
  // One calendar week, Sun (2026-08-23) through Sat (2026-08-29) — every one of these
  // maps to the SAME calendar week and therefore the same weekStart/weekDates, so
  // deadlineWindow's result must be IDENTICAL across all seven, independent of which
  // day within the week is being treated as "today".
  const WEEKDAYS = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];

  it("RED-VERIFIED: the OLD formula's width actually varied by weekday (17-23 days), proving the bug was real", () => {
    const oldWidths = WEEKDAYS.map((today, dayOfWeek) => {
      const weekStart = getWeekStartDate(today);
      const weekDates = weekDatesFrom(weekStart);
      const nextWeekDates = weekDatesFrom(addDaysToDateString(weekDates[0]!, 7));
      const dueSoonEnd = nextWeekDates[6]!;
      const oldHorizon = addDaysToDateString(today, UPCOMING_WINDOW_DAYS); // the pre-fix formula
      // Width in days from the day after Due Soon ends through the horizon, inclusive —
      // exactly what bucketTaskGroup's "next30" bucket spans.
      const width = (Date.parse(oldHorizon) - Date.parse(dueSoonEnd)) / 86_400_000;
      return { dayOfWeek, width };
    });
    // Sunday (dayOfWeek 0) through Saturday (dayOfWeek 6): 17 through 23 days — matching
    // the Lead's own "17 on Sunday, 23 on Saturday" arithmetic exactly.
    expect(oldWidths.map((w) => w.width)).toEqual([17, 18, 19, 20, 21, 22, 23]);
    // Not a constant 30 on six of the seven days — this IS the defect, reproduced
    // against the exact pre-fix formula, not just asserted from the ticket's arithmetic.
    expect(new Set(oldWidths.map((w) => w.width)).size).toBeGreaterThan(1);
  });

  it("FIXED: deadlineWindow's horizon is IDENTICAL across all seven weekdays of the same calendar week", () => {
    const horizons = WEEKDAYS.map((today) => {
      const weekDates = weekDatesFrom(getWeekStartDate(today));
      return deadlineWindow(weekDates).horizonStr;
    });
    expect(new Set(horizons).size).toBe(1);
  });

  it("FIXED: the Upcoming window is exactly UPCOMING_WINDOW_DAYS wide, on every weekday", () => {
    for (const today of WEEKDAYS) {
      const weekDates = weekDatesFrom(getWeekStartDate(today));
      const { nextWeekDates, horizonStr } = deadlineWindow(weekDates);
      const dueSoonEnd = nextWeekDates[6]!;
      const width = (Date.parse(horizonStr) - Date.parse(dueSoonEnd)) / 86_400_000;
      expect(width).toBe(UPCOMING_WINDOW_DAYS);
    }
  });

  it("includes the horizon day itself in Upcoming and excludes the day after, using the FIXED horizon end to end", () => {
    const weekDates = weekDatesFrom(getWeekStartDate("2026-08-29")); // Saturday — the old formula's worst case
    const { nextWeekDates, horizonStr } = deadlineWindow(weekDates);
    expect(bucketTaskGroup(horizonStr, "2026-08-29", weekDates, nextWeekDates, horizonStr)).toBe("next30");
    expect(bucketTaskGroup(addDaysToDateString(horizonStr, 1), "2026-08-29", weekDates, nextWeekDates, horizonStr)).toBe("future");
  });
});

describe("group order and labels", () => {
  it("orders Due Soon first, so the default view is the top of the list", () => {
    expect(TASK_GROUP_ORDER[0]).toBe("dueSoon");
  });

  it("labels the two-week head 'Due Soon', not 'This Week'", () => {
    expect(TASK_GROUP_LABEL.dueSoon).toBe("Due Soon");
    expect(Object.values(TASK_GROUP_LABEL)).not.toContain("This Week");
  });

  it("labels the rolling 30-day window 'Upcoming', not 'Next Month'", () => {
    expect(TASK_GROUP_LABEL.next30).toBe("Upcoming");
    expect(Object.values(TASK_GROUP_LABEL)).not.toContain("Next Month");
    expect(Object.values(TASK_GROUP_LABEL)).not.toContain("This Month");
  });

  it("leaves Future exactly as it was", () => {
    expect(TASK_GROUP_LABEL.future).toBe("Future");
    expect(TASK_GROUP_ORDER[TASK_GROUP_ORDER.length - 1]).toBe("future");
  });

  it("no longer exposes a top-level Today group", () => {
    expect(TASK_GROUP_ORDER).not.toContain("today" as never);
  });

  it("does not render Overdue as a group — it only shows in the School screen's Overdue KPI card", () => {
    expect(TASK_GROUP_ORDER).not.toContain("overdue");
  });
});
