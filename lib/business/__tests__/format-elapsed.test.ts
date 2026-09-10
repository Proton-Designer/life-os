import { describe, expect, it } from "vitest";
import { formatElapsedDuration, elapsedMinutesSince } from "../format-elapsed";

describe("formatElapsedDuration", () => {
  it("shows 0m for less than a minute elapsed", () => {
    expect(formatElapsedDuration(30_000)).toBe("0m");
  });

  it("shows minutes only when under an hour", () => {
    expect(formatElapsedDuration(23 * 60_000)).toBe("23m");
  });

  it("shows hours and minutes once past an hour", () => {
    expect(formatElapsedDuration(85 * 60_000)).toBe("1h 25m");
  });

  it("shows whole hours with 0m when exactly on an hour boundary", () => {
    expect(formatElapsedDuration(2 * 60 * 60_000)).toBe("2h 0m");
  });

  it("floors partial minutes rather than rounding", () => {
    expect(formatElapsedDuration(59_999)).toBe("0m");
    expect(formatElapsedDuration(119_999)).toBe("1m");
  });

  // Production finding (live browser, 2026-09-09): a Lock-In session just
  // started rendered "Locked in · -1m" -- the server's started_at can be
  // trivially ahead of the browser's clock (a Vercel cold start is enough),
  // making `now - startedAt` negative. Clamped at the chokepoint (this
  // function), not at each of the 5 call sites -- two already wrapped it in
  // Math.max(0, ...), three didn't, and "fix it everywhere it's called" is
  // exactly the bug class AGENTS.md already recorded once for this program.
  it("clamps any negative elapsed time to 0m -- a session that 'just started' must never show negative", () => {
    expect(formatElapsedDuration(-1)).toBe("0m");
    expect(formatElapsedDuration(-1200)).toBe("0m");
    expect(formatElapsedDuration(-60_000)).toBe("0m");
  });

  // The nastier property: for negatives the `hours > 0` branch never fires
  // (hours is itself negative), so an HOUR-scale clock/timezone error prints
  // as a trivial-looking "-1m" -- magnitude silently discarded. Must clamp
  // to "0m" too, not "-1h 0m" or any other magnitude-preserving negative
  // form, since "how early" was never the point; "not negative" is.
  it("clamps a whole-hour-scale negative the same way, rather than discarding the magnitude into a misleadingly small negative", () => {
    expect(formatElapsedDuration(-3_600_001)).toBe("0m");
  });
});

describe("elapsedMinutesSince", () => {
  it("returns 0 for less than a minute elapsed", () => {
    const start = "2026-08-26T12:00:00.000Z";
    const now = new Date("2026-08-26T12:00:30.000Z");
    expect(elapsedMinutesSince(start, now)).toBe(0);
  });

  it("returns whole minutes, floored, past an hour", () => {
    const start = "2026-08-26T12:00:00.000Z";
    const now = new Date("2026-08-26T13:25:59.000Z");
    expect(elapsedMinutesSince(start, now)).toBe(85);
  });

  it("never uses formatElapsedDuration's h/m split — the overlay stopwatch shows raw whole minutes", () => {
    const start = "2026-08-26T12:00:00.000Z";
    const now = new Date("2026-08-26T14:00:00.000Z");
    expect(elapsedMinutesSince(start, now)).toBe(120);
  });

  it("clamps to 0 when startedAtIso is in the future relative to now (server clock ahead of the browser's)", () => {
    const start = "2026-08-26T12:05:00.000Z";
    const now = new Date("2026-08-26T12:00:00.000Z");
    expect(elapsedMinutesSince(start, now)).toBe(0);
  });
});
