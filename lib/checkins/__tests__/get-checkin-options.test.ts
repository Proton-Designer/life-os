import { describe, expect, it } from "vitest";
import { getCheckinOptions, type CheckinDataSource } from "../get-checkin-options";

function emptyDataSource(overrides: Partial<CheckinDataSource> = {}): CheckinDataSource {
  return {
    getProfile: async () => ({ timezone: "America/Chicago" }),
    getKillListItems: async () => [],
    getWorkoutSchedule: async () => null,
    ...overrides,
  };
}

describe("getCheckinOptions", () => {
  it("puts a workout scheduled for the current window first, as a primary option", async () => {
    const now = new Date("2026-08-10T18:00:00Z"); // 2026-08-10 is a Monday, 13:00 CDT
    const dataSource = emptyDataSource({
      getWorkoutSchedule: async () => ({ workout_name: "Push", time: "13:00" }),
    });

    const options = await getCheckinOptions("user-1", now, dataSource);

    expect(options[0]).toMatchObject({ tagType: "workout", label: "Push", primary: true });
  });

  it("lists all set kill-list items as individual primary options with their exact current text", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { id: "k1", text: "Ship landing page", completed: false },
        { id: "k2", text: "Call investor", completed: false },
        { id: "k3", text: "Review PR", completed: true },
      ],
    });

    const options = await getCheckinOptions("user-1", now, dataSource);
    const killListOptions = options.filter((o) => o.tagType === "kill_list");

    expect(killListOptions).toHaveLength(3);
    expect(killListOptions.every((o) => o.primary)).toBe(true);
    expect(killListOptions.map((o) => o.label)).toEqual([
      "Ship landing page",
      "Call investor",
      "Review PR",
    ]);
    expect(killListOptions.map((o) => o.refId)).toEqual(["k1", "k2", "k3"]);
  });

  it("always includes other_work and noise as primary options", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const options = await getCheckinOptions("user-1", now, emptyDataSource());

    const otherWork = options.find((o) => o.tagType === "other_work");
    const noise = options.find((o) => o.tagType === "noise");

    expect(otherWork).toMatchObject({ primary: true, refId: null });
    expect(noise).toMatchObject({ primary: true, refId: null });
  });

  it("always lists School and Work as non-primary ('Something else') options", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const options = await getCheckinOptions("user-1", now, emptyDataSource());

    const school = options.find((o) => o.tagType === "school");
    const coOp = options.find((o) => o.tagType === "co_op");

    expect(school).toMatchObject({ primary: false });
    expect(coOp).toMatchObject({ primary: false });
  });

  it("does not surface a workout option when nothing is scheduled today", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const options = await getCheckinOptions("user-1", now, emptyDataSource());

    expect(options.find((o) => o.tagType === "workout")).toBeUndefined();
  });
});
