import { describe, expect, it } from "vitest";
import { computeDeltaMinutes, computeDeltaSeconds, formatDeltaClock } from "../delta-clock";

describe("computeDeltaMinutes — derived time since wake, never stored", () => {
  it("is zero at the instant of waking", () => {
    const wokeAt = "2026-09-14T13:00:00.000Z";
    expect(computeDeltaMinutes(wokeAt, new Date(wokeAt))).toBe(0);
  });

  it("floors partial minutes", () => {
    const wokeAt = "2026-09-14T13:00:00.000Z";
    const now = new Date("2026-09-14T13:04:59.000Z");
    expect(computeDeltaMinutes(wokeAt, now)).toBe(4);
  });

  it("crosses local midnight correctly — it is instant math, not calendar math", () => {
    // Woke at 23:30 UTC, now is 01:15 the NEXT UTC day — this must read as
    // ~105 minutes elapsed, not reset to zero because the calendar date
    // changed. Delta clock has no notion of "day" at all; that is the
    // exact property that makes it safe across the boundary this codebase
    // has shipped bugs on before.
    const wokeAt = "2026-09-14T23:30:00.000Z";
    const now = new Date("2026-09-15T01:15:00.000Z");
    expect(computeDeltaMinutes(wokeAt, now)).toBe(105);
  });

  it("clamps at zero when now is before the wake mark (clock skew)", () => {
    const wokeAt = "2026-09-14T13:00:00.000Z";
    const now = new Date("2026-09-14T12:59:00.000Z");
    expect(computeDeltaMinutes(wokeAt, now)).toBe(0);
  });
});

describe("computeDeltaSeconds — the ticking clock's own precision", () => {
  it("is zero at the instant of waking", () => {
    const wokeAt = "2026-09-14T13:00:00.000Z";
    expect(computeDeltaSeconds(wokeAt, new Date(wokeAt))).toBe(0);
  });

  it("counts whole seconds, not minutes", () => {
    const wokeAt = "2026-09-14T13:00:00.000Z";
    const now = new Date("2026-09-14T13:00:47.000Z");
    expect(computeDeltaSeconds(wokeAt, now)).toBe(47);
  });
});

describe("formatDeltaClock — a stopwatch face", () => {
  it("renders m:ss under an hour", () => {
    expect(formatDeltaClock(47)).toBe("0:47");
    expect(formatDeltaClock(8 * 60 + 3)).toBe("8:03");
  });

  it("renders h:mm:ss once past an hour", () => {
    expect(formatDeltaClock(3 * 3600 + 42 * 60 + 17)).toBe("3:42:17");
  });

  it("pads minutes and seconds to two digits", () => {
    expect(formatDeltaClock(3661)).toBe("1:01:01");
  });
});
