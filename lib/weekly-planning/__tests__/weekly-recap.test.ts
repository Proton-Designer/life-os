import { describe, expect, it } from "vitest";
import { buildWeeklyRecap, type WeekWindow } from "../weekly-recap";

const weeks: WeekWindow[] = [
  { weekStart: "2026-08-02", label: "Aug 2" },
  { weekStart: "2026-08-09", label: "Aug 9" },
];

describe("buildWeeklyRecap", () => {
  it("counts on_time/qada prayers per week, excluding missed", () => {
    const result = buildWeeklyRecap(
      [
        { date: "2026-08-03", status: "on_time" },
        { date: "2026-08-04", status: "qada" },
        { date: "2026-08-04", status: "missed" },
        { date: "2026-08-10", status: "on_time" },
      ],
      [],
      [],
      weeks
    );
    expect(result[0].prayersOnTime).toBe(2);
    expect(result[1].prayersOnTime).toBe(1);
  });

  it("counts completed adhkar per week", () => {
    const result = buildWeeklyRecap(
      [],
      [
        { date: "2026-08-03", completed: true },
        { date: "2026-08-04", completed: false },
        { date: "2026-08-10", completed: true },
        { date: "2026-08-10", completed: true },
      ],
      [],
      weeks
    );
    expect(result[0].adhkarDone).toBe(1);
    expect(result[1].adhkarDone).toBe(2);
  });

  it("sums Qur'an pages read per week", () => {
    const result = buildWeeklyRecap(
      [],
      [],
      [
        { date: "2026-08-03", pages_read: 5 },
        { date: "2026-08-05", pages_read: 3 },
        { date: "2026-08-11", pages_read: 10 },
      ],
      weeks
    );
    expect(result[0].quranPages).toBe(8);
    expect(result[1].quranPages).toBe(10);
  });

  it("labels each week from the given window and returns 0s for a week with no data", () => {
    const result = buildWeeklyRecap([], [], [], weeks);
    expect(result).toEqual([
      { label: "Aug 2", prayersOnTime: 0, adhkarDone: 0, quranPages: 0 },
      { label: "Aug 9", prayersOnTime: 0, adhkarDone: 0, quranPages: 0 },
    ]);
  });
});
