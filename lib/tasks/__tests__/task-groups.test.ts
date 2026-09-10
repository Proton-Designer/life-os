import { describe, expect, it } from "vitest";
import { bucketTaskGroup, groupTasksByBucket, splitDueSoon, TASK_GROUP_ORDER, TASK_GROUP_LABEL } from "../task-groups";

const TODAY = "2026-08-25"; // Tuesday
const TOMORROW = "2026-08-26";
const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];
const HORIZON = "2026-09-24"; // TODAY + 30 days

const bucket = (due: string | null, today = TODAY, tomorrow = TOMORROW, week = WEEK_DATES, horizon = HORIZON) =>
  bucketTaskGroup(due, today, tomorrow, week, horizon);

describe("bucketTaskGroup", () => {
  it("buckets today into This Week", () => {
    expect(bucket(TODAY)).toBe("week");
  });

  it("buckets tomorrow into This Week", () => {
    expect(bucket(TOMORROW)).toBe("week");
  });

  it("buckets another day in this week's Sun-Sat range into This Week", () => {
    expect(bucket("2026-08-29")).toBe("week");
  });

  it("buckets an earlier day of this week (already overdue) into This Week, not Next Month", () => {
    expect(bucket("2026-08-23")).toBe("week");
  });

  it("buckets a date beyond this week but inside 30 days into Next Month", () => {
    expect(bucket("2026-09-10")).toBe("next30");
  });

  it("includes the 30th day itself in Next Month, and excludes the 31st", () => {
    expect(bucket("2026-09-24")).toBe("next30");
    expect(bucket("2026-09-25")).toBe("future");
  });

  it("buckets a null due date as Future", () => {
    expect(bucket(null)).toBe("future");
  });

  describe("Next Month is a rolling 30 days, not a calendar month", () => {
    it("keeps a date in the NEXT calendar month inside the window", () => {
      // The old YYYY-MM prefix rule sent this to "Future" purely for
      // crossing a month boundary that is 16 days away.
      expect(bucket("2026-09-10")).toBe("next30");
    });

    it("does not empty out at the end of a month", () => {
      const eom = "2026-08-31";
      const eomWeek = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
      expect(bucketTaskGroup("2026-09-20", eom, "2026-09-01", eomWeek, "2026-09-30")).toBe("next30");
    });
  });

  describe("overdue work never falls through to Future", () => {
    it("puts a task overdue from before this week into Next Month, where it stays visible", () => {
      expect(bucket("2026-08-10")).toBe("next30");
    });

    it("puts a task overdue from a previous calendar month there too", () => {
      // Under the old calendar-prefix rule this landed in "Future"; the
      // windowed rule has no lower bound precisely so it doesn't.
      expect(bucket("2026-07-30")).toBe("next30");
    });
  });

  describe("tomorrow outranks the week boundary", () => {
    // Saturday: tomorrow is Sunday, which belongs to NEXT week's Sun-Sat range.
    const SATURDAY = "2026-08-29";
    const SUNDAY = "2026-08-30";

    it("pulls tomorrow into This Week even when tomorrow is in next week", () => {
      expect(bucketTaskGroup(SUNDAY, SATURDAY, SUNDAY, WEEK_DATES, "2026-09-28")).toBe("week");
    });

    it("still sends the day after tomorrow to Next Month", () => {
      expect(bucketTaskGroup("2026-08-31", SATURDAY, SUNDAY, WEEK_DATES, "2026-09-28")).toBe("next30");
    });
  });
});

describe("groupTasksByBucket", () => {
  it("sorts each bucket soonest-first, with null due dates last", () => {
    const tasks = [
      { id: "later-week", dueDate: "2026-08-28" },
      { id: "today", dueDate: TODAY },
      { id: "no-date", dueDate: null },
      { id: "next-month", dueDate: "2026-09-15" },
      { id: "far", dueDate: "2027-01-01" },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, TOMORROW, WEEK_DATES, HORIZON);

    expect(groups.week.map((t) => t.id)).toEqual(["today", "later-week"]);
    expect(groups.next30.map((t) => t.id)).toEqual(["next-month"]);
    expect(groups.future.map((t) => t.id)).toEqual(["far", "no-date"]);
  });

  it("returns every group key even when empty", () => {
    const groups = groupTasksByBucket([], TODAY, TOMORROW, WEEK_DATES, HORIZON);
    expect(Object.keys(groups).sort()).toEqual([...TASK_GROUP_ORDER].sort());
  });
});

describe("splitDueSoon", () => {
  const weekTasks = [
    { id: "overdue-this-week", dueDate: "2026-08-23" },
    { id: "today", dueDate: TODAY },
    { id: "tomorrow", dueDate: TOMORROW },
    { id: "friday", dueDate: "2026-08-28" },
  ];

  it("puts today and tomorrow in Due Soon", () => {
    const { dueSoon } = splitDueSoon(weekTasks, TODAY, TOMORROW);
    expect(dueSoon.map((t) => t.id)).toEqual(["today", "tomorrow"]);
  });

  it("leaves the rest of the week behind, order preserved", () => {
    const { rest } = splitDueSoon(weekTasks, TODAY, TOMORROW);
    expect(rest.map((t) => t.id)).toEqual(["overdue-this-week", "friday"]);
  });

  it("does not promote overdue work into Due Soon", () => {
    const { dueSoon } = splitDueSoon(weekTasks, TODAY, TOMORROW);
    expect(dueSoon.map((t) => t.id)).not.toContain("overdue-this-week");
  });

  it("splits nothing when the week is empty", () => {
    expect(splitDueSoon([], TODAY, TOMORROW)).toEqual({ dueSoon: [], rest: [] });
  });

  it("loses no task — every week item lands in exactly one half", () => {
    const { dueSoon, rest } = splitDueSoon(weekTasks, TODAY, TOMORROW);
    expect([...dueSoon, ...rest].map((t) => t.id).sort()).toEqual(weekTasks.map((t) => t.id).sort());
  });
});

describe("group order and labels", () => {
  it("orders This Week first, so the default view is the top of the list", () => {
    expect(TASK_GROUP_ORDER[0]).toBe("week");
  });

  it("labels the rolling window 'Next Month', not 'This Month'", () => {
    expect(TASK_GROUP_LABEL.next30).toBe("Next Month");
    expect(Object.values(TASK_GROUP_LABEL)).not.toContain("This Month");
  });

  it("no longer exposes a top-level Today group", () => {
    expect(TASK_GROUP_ORDER).not.toContain("today" as never);
  });
});
