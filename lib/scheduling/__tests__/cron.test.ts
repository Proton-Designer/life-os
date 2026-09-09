import { describe, expect, it } from "vitest";
import { parseCronExpression, isValidCronExpression, computeNextRunAt } from "../cron";

describe("parseCronExpression", () => {
  it("parses a daily expression", () => {
    expect(parseCronExpression("30 7 * * *")).toEqual({ minute: 30, hour: 7, dayOfWeek: null });
  });

  it("parses a weekly expression", () => {
    expect(parseCronExpression("0 20 * * 0")).toEqual({ minute: 0, hour: 20, dayOfWeek: 0 });
  });

  it("rejects day-of-month/month fields (not '*')", () => {
    expect(parseCronExpression("0 9 15 * *")).toBeNull();
    expect(parseCronExpression("0 9 * 6 *")).toBeNull();
  });

  it("rejects ranges/steps/lists — the restricted grammar, not full cron", () => {
    expect(parseCronExpression("*/15 9-17 * * 1-5")).toBeNull();
    expect(parseCronExpression("0,30 9 * * *")).toBeNull();
  });

  it("rejects an out-of-range hour/minute/day-of-week", () => {
    expect(parseCronExpression("60 9 * * *")).toBeNull();
    expect(parseCronExpression("0 24 * * *")).toBeNull();
    expect(parseCronExpression("0 9 * * 7")).toBeNull();
  });

  it("isValidCronExpression matches parseCronExpression's own verdict", () => {
    expect(isValidCronExpression("30 7 * * *")).toBe(true);
    expect(isValidCronExpression("garbage")).toBe(false);
  });
});

describe("computeNextRunAt — daily", () => {
  it("today's occurrence, when it's still ahead of `after`", () => {
    // 07:00 America/Chicago (UTC-5 in September) = 12:00 UTC
    const after = new Date("2026-09-08T11:00:00.000Z"); // 06:00 CDT
    const next = computeNextRunAt("0 7 * * *", after, "America/Chicago");
    expect(next.toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });

  it("rolls to tomorrow when today's occurrence has already passed", () => {
    const after = new Date("2026-09-08T13:00:00.000Z"); // 08:00 CDT, past 07:00
    const next = computeNextRunAt("0 7 * * *", after, "America/Chicago");
    expect(next.toISOString()).toBe("2026-09-09T12:00:00.000Z");
  });

  it("never returns an instant equal to `after` — strictly after, so a just-fired action doesn't immediately re-qualify", () => {
    const after = new Date("2026-09-08T12:00:00.000Z"); // exactly 07:00 CDT
    const next = computeNextRunAt("0 7 * * *", after, "America/Chicago");
    expect(next.getTime()).toBeGreaterThan(after.getTime());
    expect(next.toISOString()).toBe("2026-09-09T12:00:00.000Z");
  });

  // AGENTS.md's rule: pin the exact UTC-rollover boundary, both sides, plus
  // a timezone EAST of UTC (the inverse case).
  it("18:59 local (Chicago, UTC-5) and 19:01 local both correctly resolve 'today' locally, even though UTC has already rolled over between them", () => {
    const before = computeNextRunAt("0 20 * * *", new Date("2026-09-08T23:59:00.000Z"), "America/Chicago"); // 18:59 CDT
    expect(before.toISOString()).toBe("2026-09-09T01:00:00.000Z"); // 20:00 CDT the SAME local day (8th)

    const after = computeNextRunAt("0 20 * * *", new Date("2026-09-09T00:01:00.000Z"), "America/Chicago"); // 19:01 CDT, still the 8th locally
    expect(after.toISOString()).toBe("2026-09-09T01:00:00.000Z"); // same target instant — both queries are "before 20:00 on the 8th"
  });

  it("a timezone EAST of UTC (Asia/Tokyo, UTC+9) also resolves correctly", () => {
    // 09:00 JST = 00:00 UTC. Querying at 08:00 UTC (17:00 JST, already past today's 09:00) must roll to tomorrow.
    const next = computeNextRunAt("0 9 * * *", new Date("2026-09-08T08:00:00.000Z"), "Asia/Tokyo");
    expect(next.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe("computeNextRunAt — weekly", () => {
  it("finds the next matching weekday, skipping non-matching days", () => {
    // 2026-09-08 is a Tuesday (dayOfWeek 2). Schedule is Sunday (0) at 20:00.
    const after = new Date("2026-09-08T12:00:00.000Z");
    const next = computeNextRunAt("0 20 * * 0", after, "America/Chicago");
    // Next Sunday is 2026-09-13.
    expect(next.toISOString()).toBe("2026-09-14T01:00:00.000Z"); // 20:00 CDT on the 13th = 01:00Z on the 14th
  });

  it("fires TODAY when today already matches the weekday and the time is still ahead", () => {
    // 2026-09-08 is a Tuesday. Schedule is Tuesday (2) at 20:00; `after` is 12:00 CDT the same day.
    const after = new Date("2026-09-08T17:00:00.000Z"); // 12:00 CDT
    const next = computeNextRunAt("0 20 * * 2", after, "America/Chicago");
    expect(next.toISOString()).toBe("2026-09-09T01:00:00.000Z"); // 20:00 CDT on the 8th
  });

  it("rolls a full week when today matches but the time already passed", () => {
    const after = new Date("2026-09-09T02:00:00.000Z"); // 21:00 CDT on the 8th (Tuesday), past the 20:00 target
    const next = computeNextRunAt("0 20 * * 2", after, "America/Chicago");
    expect(next.toISOString()).toBe("2026-09-16T01:00:00.000Z"); // the FOLLOWING Tuesday
  });
});

describe("computeNextRunAt — invalid input", () => {
  it("throws a clear, actionable error for an unparseable expression", () => {
    expect(() => computeNextRunAt("not a cron", new Date(), "UTC")).toThrow(/not a valid schedule/i);
  });
});
