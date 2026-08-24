import { describe, expect, it } from "vitest";
import { buildReflectionMonth } from "../reflection-month";

describe("buildReflectionMonth", () => {
  it("pads to full weeks, starting Sunday and ending Saturday", () => {
    // August 2026: 1st is a Saturday.
    const days = buildReflectionMonth([], 2026, 8, "2026-08-15");
    expect(days.length % 7).toBe(0);
    expect(new Date(`${days[0].date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(new Date(`${days[days.length - 1].date}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it("a month starting on Sunday needs no leading padding", () => {
    // November 2026: 1st is a Sunday.
    const days = buildReflectionMonth([], 2026, 11, "2026-11-15");
    expect(days[0].date).toBe("2026-11-01");
    expect(days[0].inMonth).toBe(true);
  });

  it("a month starting on Saturday pads six leading days", () => {
    // August 2026: 1st is a Saturday.
    const days = buildReflectionMonth([], 2026, 8, "2026-08-15");
    const leadingPadding = days.slice(0, 6);
    expect(leadingPadding.every((d) => !d.inMonth)).toBe(true);
    expect(days[6].date).toBe("2026-08-01");
    expect(days[6].inMonth).toBe(true);
  });

  it("marks every day in the target month inMonth and every padding day not", () => {
    const days = buildReflectionMonth([], 2026, 8, "2026-08-15");
    const inMonthDays = days.filter((d) => d.inMonth);
    expect(inMonthDays).toHaveLength(31);
    expect(inMonthDays[0].date).toBe("2026-08-01");
    expect(inMonthDays[30].date).toBe("2026-08-31");
  });

  it("an empty month has every past/today day clear or in_progress, and every future day empty", () => {
    const days = buildReflectionMonth([], 2026, 8, "2026-08-15");
    const inMonthDays = days.filter((d) => d.inMonth);
    for (const d of inMonthDays) {
      if (d.date < "2026-08-15") expect(d.bucket).toBe("clear");
      else if (d.date === "2026-08-15") expect(d.bucket).toBe("in_progress");
      else expect(d.bucket).toBe("empty");
    }
  });

  it("handles a leap-year February", () => {
    const days = buildReflectionMonth([], 2028, 2, "2028-02-10");
    const inMonthDays = days.filter((d) => d.inMonth);
    expect(inMonthDays).toHaveLength(29);
    expect(inMonthDays[28].date).toBe("2028-02-29");
  });

  it("a non-leap-year February has 28 days", () => {
    const days = buildReflectionMonth([], 2026, 2, "2026-02-10");
    const inMonthDays = days.filter((d) => d.inMonth);
    expect(inMonthDays).toHaveLength(28);
    expect(inMonthDays[27].date).toBe("2026-02-28");
  });

  it("sums multiple entries on the same day into per-tier counts and a bucketed weight", () => {
    const days = buildReflectionMonth(
      [
        { date: "2026-08-10", tier: 3 },
        { date: "2026-08-10", tier: 3 },
        { date: "2026-08-10", tier: 1 },
      ],
      2026,
      8,
      "2026-08-15"
    );
    const day = days.find((d) => d.date === "2026-08-10")!;
    expect(day.counts).toEqual({ light: 1, moderate: 0, heavy: 2 });
    expect(day.weight).toBe(7);
    expect(day.bucket).toBe("high");
  });

  it("today with entries already logged shows its real bucket, not in_progress", () => {
    const days = buildReflectionMonth([{ date: "2026-08-15", tier: 3 }], 2026, 8, "2026-08-15");
    const today = days.find((d) => d.date === "2026-08-15")!;
    expect(today.bucket).toBe("mid");
    expect(today.isToday).toBe(true);
  });

  it("a future day inside the month is empty even with no entries, not clear", () => {
    const days = buildReflectionMonth([], 2026, 8, "2026-08-15");
    const future = days.find((d) => d.date === "2026-08-20")!;
    expect(future.bucket).toBe("empty");
    expect(future.weight).toBe(0);
  });

  it("padding days from the adjacent month are never marked today", () => {
    const days = buildReflectionMonth([], 2026, 8, "2026-08-01");
    expect(days.some((d) => !d.inMonth && d.isToday)).toBe(false);
  });
});
