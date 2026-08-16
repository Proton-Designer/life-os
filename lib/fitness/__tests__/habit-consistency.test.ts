import { describe, expect, it } from "vitest";
import { buildHabitConsistencyRows } from "../habit-consistency";

describe("buildHabitConsistencyRows", () => {
  const days = ["2026-08-13", "2026-08-14", "2026-08-15"];

  it("marks a day done when a completed log exists", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "Run", createdAt: "2026-08-01" }],
      [{ habitId: "h1", date: "2026-08-14", completed: true }],
      days,
      "2026-08-15"
    );
    expect(rows[0].cells.map((c) => c.status)).toEqual(["missed", "done", "missed"]);
  });

  it("marks days before the habit's createdAt as not_tracked, not missed", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "Run", createdAt: "2026-08-14" }],
      [],
      days,
      "2026-08-15"
    );
    expect(rows[0].cells.map((c) => c.status)).toEqual(["not_tracked", "missed", "missed"]);
  });

  it("marks days after today as not_tracked — the future isn't missed yet", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "Run", createdAt: "2026-08-01" }],
      [],
      days,
      "2026-08-14"
    );
    expect(rows[0].cells.map((c) => c.status)).toEqual(["missed", "missed", "not_tracked"]);
  });

  it("uses the habit's name as the row label", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "Stretch", createdAt: "2026-08-01" }],
      [],
      days,
      "2026-08-15"
    );
    expect(rows[0].label).toBe("Stretch");
  });
});
