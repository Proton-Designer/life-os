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

  it("buckets an earlier day of this week (already overdue) into Overdue, not This Week (reversed 2026-09-10: overdue now auto-removes from the list)", () => {
    expect(bucket("2026-08-23")).toBe("overdue");
  });

  it("buckets yesterday into Overdue", () => {
    expect(bucket("2026-08-24")).toBe("overdue");
  });

  it("does not treat today itself as overdue", () => {
    expect(bucket(TODAY)).not.toBe("overdue");
    expect(bucket(TODAY)).toBe("week");
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

  describe("overdue work always lands in Overdue, not Next Month or Future (reversed 2026-09-10: overdue now has its own bucket, extracted before next30's window is ever consulted)", () => {
    it("puts a task overdue from before this week into Overdue, not Next Month", () => {
      // Until 2026-09-10 this landed in "next30" specifically so it stayed
      // visible instead of falling through to "Future". Now it has a real
      // home: the Overdue KPI card, via this same bucket.
      expect(bucket("2026-08-10")).toBe("overdue");
    });

    it("puts a task overdue from a previous calendar month there too, no matter how old", () => {
      expect(bucket("2026-07-30")).toBe("overdue");
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

  it("sorts the overdue bucket oldest-first too, even though nothing renders it today", () => {
    const tasks = [
      { id: "week-and-half-ago", dueDate: "2026-08-16" },
      { id: "yesterday", dueDate: "2026-08-24" },
      { id: "three-weeks-ago", dueDate: "2026-08-04" },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, TOMORROW, WEEK_DATES, HORIZON);
    expect(groups.overdue.map((t) => t.id)).toEqual(["three-weeks-ago", "week-and-half-ago", "yesterday"]);
  });

  // Reversed 2026-09-10: this used to assert the returned keys equal
  // TASK_GROUP_ORDER, back when they were the same list. They are now
  // deliberately different — `groupTasksByBucket` returns all four real
  // buckets; `TASK_GROUP_ORDER` names only the three `TaskListModule`
  // renders. Split into the two claims that actually matter now.
  it("returns all four bucket keys even when empty, not just the rendered three", () => {
    const groups = groupTasksByBucket([], TODAY, TOMORROW, WEEK_DATES, HORIZON);
    expect(Object.keys(groups).sort()).toEqual(["future", "next30", "overdue", "week"]);
  });

  it("TASK_GROUP_ORDER is every bucket key except overdue", () => {
    const groups = groupTasksByBucket([], TODAY, TOMORROW, WEEK_DATES, HORIZON);
    const allKeys = Object.keys(groups).sort();
    const missing = allKeys.filter((k) => !TASK_GROUP_ORDER.includes(k as never));
    expect(missing).toEqual(["overdue"]);
  });

  it("loses no task — every input task appears in exactly one of the four buckets", () => {
    const tasks = [
      { id: "overdue-old", dueDate: "2026-07-01" },
      { id: "overdue-this-week", dueDate: "2026-08-23" },
      { id: "today", dueDate: TODAY },
      { id: "tomorrow", dueDate: TOMORROW },
      { id: "later-week", dueDate: "2026-08-28" },
      { id: "next-month", dueDate: "2026-09-15" },
      { id: "far-future", dueDate: "2027-01-01" },
      { id: "no-date", dueDate: null },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, TOMORROW, WEEK_DATES, HORIZON);
    const union = [...groups.overdue, ...groups.week, ...groups.next30, ...groups.future].map((t) => t.id).sort();
    expect(union).toEqual(tasks.map((t) => t.id).sort());
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

  it("does not render Overdue as a group — it only shows in the School screen's Overdue KPI card", () => {
    expect(TASK_GROUP_ORDER).not.toContain("overdue");
  });
});
