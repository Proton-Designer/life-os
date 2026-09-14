import { describe, expect, it } from "vitest";
import { computeOpenDiff, type OpenRankedTask } from "../diff-banner";

const full: OpenRankedTask[] = [
  { id: "a", title: "Crowned", mit_rank: 1, completed: false },
  { id: "b", title: "Second", mit_rank: 2, completed: false },
  { id: "c", title: "Third", mit_rank: 3, completed: false },
];

describe("computeOpenDiff", () => {
  it("reports no change for an untouched plan", () => {
    const diff = computeOpenDiff(full);
    expect(diff.changed).toBe(false);
    expect(diff.message).toBeNull();
  });

  it("flags a completed ranked task", () => {
    const diff = computeOpenDiff([full[0]!, { ...full[1]!, completed: true }, full[2]!]);
    expect(diff.changed).toBe(true);
    expect(diff.completedCount).toBe(1);
    expect(diff.goneCount).toBe(0);
    expect(diff.message).toBe("Your day changed — 1 of these is already done.");
  });

  it("pluralizes two completed", () => {
    const diff = computeOpenDiff([{ ...full[0]!, completed: true }, { ...full[1]!, completed: true }, full[2]!]);
    expect(diff.message).toBe("Your day changed — 2 of these are already done.");
  });

  it("flags a gap in the rank sequence as a vanished task — rank 2 missing", () => {
    const diff = computeOpenDiff([full[0]!, full[2]!]); // ranks {1, 3}, 2 absent
    expect(diff.changed).toBe(true);
    expect(diff.goneCount).toBe(1);
    expect(diff.completedCount).toBe(0);
    expect(diff.message).toBe("Your day changed — 1 moved or is gone.");
  });

  it("flags rank 1 missing when 2 and 3 remain", () => {
    const diff = computeOpenDiff([full[1]!, full[2]!]);
    expect(diff.goneCount).toBe(1);
  });

  it("combines both triggers in one message", () => {
    const diff = computeOpenDiff([{ ...full[0]!, completed: true }, full[2]!]); // rank 2 gone, rank 1 completed
    expect(diff.completedCount).toBe(1);
    expect(diff.goneCount).toBe(1);
    expect(diff.message).toBe("Your day changed — 1 of these is already done; 1 moved or is gone.");
  });

  it("a single-item plan intact is not flagged", () => {
    const diff = computeOpenDiff([full[0]!]);
    expect(diff.changed).toBe(false);
  });

  it("an empty plan is not flagged here — that renders the separate no-plan branch", () => {
    const diff = computeOpenDiff([]);
    expect(diff.changed).toBe(false);
  });
});
