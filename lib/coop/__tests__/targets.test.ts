import { describe, expect, it } from "vitest";
import {
  splitTargetsAndStretch,
  nextTargetPosition,
  nextStretchPosition,
  moveTargetPosition,
  formatDaysLeft,
  type CoopTargetRow,
} from "../targets";

function row(position: number, id = `r${position}`): CoopTargetRow {
  return { id, title: `Row ${position}`, deadline: null, position };
}

describe("splitTargetsAndStretch", () => {
  it("splits at position <= 3, sorted ascending regardless of input order", () => {
    const { targets, stretchGoals } = splitTargetsAndStretch([row(4), row(1), row(3), row(2), row(5)]);
    expect(targets.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(stretchGoals.map((r) => r.position)).toEqual([4, 5]);
  });

  it("returns empty arrays for an empty queue", () => {
    expect(splitTargetsAndStretch([])).toEqual({ targets: [], stretchGoals: [] });
  });

  it("handles fewer than 3 targets and no stretch goals", () => {
    const { targets, stretchGoals } = splitTargetsAndStretch([row(1)]);
    expect(targets).toHaveLength(1);
    expect(stretchGoals).toHaveLength(0);
  });
});

describe("nextTargetPosition", () => {
  it("is 1 for an empty queue, 4 once 3 targets exist", () => {
    expect(nextTargetPosition([])).toBe(1);
    expect(nextTargetPosition([row(1), row(2), row(3)])).toBe(4);
  });
});

describe("nextStretchPosition", () => {
  it("is 4 (TARGET_SLOT_COUNT + 1) for an empty queue", () => {
    expect(nextStretchPosition([])).toBe(4);
  });

  it("appends after the highest existing position, target or stretch", () => {
    expect(nextStretchPosition([row(1), row(2)])).toBe(3);
    expect(nextStretchPosition([row(1), row(2), row(3), row(4)])).toBe(5);
  });
});

describe("moveTargetPosition", () => {
  it("moves up/down within bounds", () => {
    expect(moveTargetPosition(2, "up", 5)).toBe(1);
    expect(moveTargetPosition(2, "down", 5)).toBe(3);
  });

  it("returns null at the top edge moving up", () => {
    expect(moveTargetPosition(1, "up", 5)).toBeNull();
  });

  it("returns null at the bottom edge moving down", () => {
    expect(moveTargetPosition(5, "down", 5)).toBeNull();
  });
});

describe("formatDaysLeft", () => {
  const now = new Date("2026-08-20T15:00:00");

  it("counts whole calendar days, ignoring time of day, and reads positive when comfortably ahead", () => {
    expect(formatDaysLeft("2026-09-01", now)).toEqual({ label: "12 days left", urgency: "positive" });
  });

  it("singular for exactly 1 day left, and reads warning inside the 1-3 day window", () => {
    expect(formatDaysLeft("2026-08-21", now)).toEqual({ label: "1 day left", urgency: "warning" });
    expect(formatDaysLeft("2026-08-23", now)).toEqual({ label: "3 days left", urgency: "warning" });
  });

  it("4 days left is back to positive — the warning window is 1-3 days", () => {
    expect(formatDaysLeft("2026-08-24", now)).toEqual({ label: "4 days left", urgency: "positive" });
  });

  it("reads 'Due today' as negative, regardless of current time", () => {
    expect(formatDaysLeft("2026-08-20", now)).toEqual({ label: "Due today", urgency: "negative" });
  });

  it("reads overdue, singular and plural, as negative", () => {
    expect(formatDaysLeft("2026-08-19", now)).toEqual({ label: "1 day overdue", urgency: "negative" });
    expect(formatDaysLeft("2026-08-10", now)).toEqual({ label: "10 days overdue", urgency: "negative" });
  });
});
