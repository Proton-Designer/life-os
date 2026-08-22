import { describe, expect, it } from "vitest";
import {
  DEFAULT_AXIS_START_MIN,
  DEFAULT_AXIS_END_MIN,
  computeAxis,
  layoutDaySessions,
  minutesFromMidnight,
  positionPct,
  type TimedSession,
} from "../workouts/day-grid";

describe("minutesFromMidnight", () => {
  it("parses HH:MM", () => {
    expect(minutesFromMidnight("00:00")).toBe(0);
    expect(minutesFromMidnight("07:30")).toBe(450);
    expect(minutesFromMidnight("23:59")).toBe(1439);
  });

  it("throws on malformed input rather than silently misplacing a block", () => {
    expect(() => minutesFromMidnight("7:3")).toThrow();
    expect(() => minutesFromMidnight("24:00")).toThrow();
    expect(() => minutesFromMidnight("12:60")).toThrow();
    expect(() => minutesFromMidnight("")).toThrow();
    expect(() => minutesFromMidnight("noon")).toThrow();
  });
});

describe("positionPct", () => {
  it("clamps to 0-100 across the axis", () => {
    expect(positionPct(300, 300, 1380)).toBe(0);
    expect(positionPct(1380, 300, 1380)).toBe(100);
    expect(positionPct(840, 300, 1380)).toBeCloseTo(50, 5);
  });

  it("clamps out-of-range input instead of returning negative or >100", () => {
    expect(positionPct(0, 300, 1380)).toBe(0);
    expect(positionPct(2000, 300, 1380)).toBe(100);
  });

  it("returns 0 for a degenerate zero/negative span rather than dividing by zero", () => {
    expect(positionPct(500, 500, 500)).toBe(0);
    expect(positionPct(500, 600, 500)).toBe(0);
  });
});

describe("computeAxis", () => {
  it("defaults to 05:00-23:00 when every session fits inside it", () => {
    const sessions: TimedSession[] = [{ id: "a", name: "A", startMinutes: 7 * 60, durationMinutes: 30 }];
    expect(computeAxis(sessions)).toEqual({ startMin: DEFAULT_AXIS_START_MIN, endMin: DEFAULT_AXIS_END_MIN });
  });

  it("expands the start when a session begins before 05:00", () => {
    const sessions: TimedSession[] = [{ id: "a", name: "A", startMinutes: 4 * 60, durationMinutes: 30 }];
    expect(computeAxis(sessions).startMin).toBe(4 * 60);
  });

  it("expands the end when a session runs past 23:00", () => {
    const sessions: TimedSession[] = [{ id: "a", name: "A", startMinutes: 22 * 60 + 45, durationMinutes: 45 }];
    expect(computeAxis(sessions).endMin).toBe(23 * 60 + 30);
  });

  it("handles an empty session list without throwing", () => {
    expect(computeAxis([])).toEqual({ startMin: DEFAULT_AXIS_START_MIN, endMin: DEFAULT_AXIS_END_MIN });
  });
});

describe("layoutDaySessions", () => {
  function s(id: string, startMinutes: number, durationMinutes: number): TimedSession {
    return { id, name: id, startMinutes, durationMinutes };
  }

  it("gives every session its own single column when nothing overlaps", () => {
    const layout = layoutDaySessions([s("a", 7 * 60, 60), s("b", 9 * 60, 60), s("c", 18 * 60, 30)]);
    expect(layout.every((l) => l.columnCount === 1 && l.columnIndex === 0)).toBe(true);
  });

  it("splits two overlapping sessions into two side-by-side columns", () => {
    const layout = layoutDaySessions([s("a", 7 * 60, 60), s("b", 7 * 60 + 30, 60)]);
    const byId = Object.fromEntries(layout.map((l) => [l.session.id, l]));
    expect(byId.a.columnCount).toBe(2);
    expect(byId.b.columnCount).toBe(2);
    expect(byId.a.columnIndex).not.toBe(byId.b.columnIndex);
  });

  it("puts three mutually-overlapping sessions into three columns", () => {
    const layout = layoutDaySessions([s("a", 7 * 60, 90), s("b", 7 * 60 + 15, 90), s("c", 7 * 60 + 30, 90)]);
    const columns = new Set(layout.map((l) => l.columnIndex));
    expect(columns.size).toBe(3);
    expect(layout.every((l) => l.columnCount === 3)).toBe(true);
  });

  it("does not squeeze an unrelated later session into a cluster's column count", () => {
    const layout = layoutDaySessions([s("a", 7 * 60, 60), s("b", 7 * 60 + 30, 60), s("evening", 18 * 60, 30)]);
    const evening = layout.find((l) => l.session.id === "evening")!;
    expect(evening.columnCount).toBe(1);
    expect(evening.columnIndex).toBe(0);
  });

  it("treats back-to-back sessions (end == next start) as non-overlapping", () => {
    const layout = layoutDaySessions([s("a", 7 * 60, 60), s("b", 8 * 60, 60)]);
    expect(layout.every((l) => l.columnCount === 1)).toBe(true);
  });

  it("reuses a freed column once its session ends, rather than growing columns forever", () => {
    // a: 7:00-8:00, b: 7:30-8:30 (overlaps a), c: 8:15-9:00 (overlaps b only, a has ended relative to c's start? a ends 8:00, c starts 8:15 -> no overlap with a)
    const layout = layoutDaySessions([s("a", 7 * 60, 60), s("b", 7 * 60 + 30, 60), s("c", 8 * 60 + 15, 45)]);
    const columns = new Set(layout.map((l) => l.columnIndex));
    // a and c never overlap, so c can reuse a's column (0) once it's free — max concurrent overlap here is 2.
    expect(columns.size).toBe(2);
    expect(layout.every((l) => l.columnCount === 2)).toBe(true);
  });

  it("handles an empty list", () => {
    expect(layoutDaySessions([])).toEqual([]);
  });
});
