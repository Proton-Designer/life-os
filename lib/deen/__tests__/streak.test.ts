import { describe, expect, it } from "vitest";
import { computeQuranStreak } from "../streak";

describe("computeQuranStreak", () => {
  it("counts consecutive days ending today when today has a session", () => {
    const streak = computeQuranStreak(
      ["2026-08-08", "2026-08-09", "2026-08-10"],
      "2026-08-10"
    );
    expect(streak).toBe(3);
  });

  it("still counts the streak through yesterday if today hasn't logged yet", () => {
    const streak = computeQuranStreak(["2026-08-08", "2026-08-09"], "2026-08-10");
    expect(streak).toBe(2);
  });

  it("hard-resets to 0 on a missed day (no freeze mechanic, per spec)", () => {
    const streak = computeQuranStreak(["2026-08-05", "2026-08-06", "2026-08-10"], "2026-08-10");
    expect(streak).toBe(1);
  });

  it("returns 0 when there are no sessions at all", () => {
    expect(computeQuranStreak([], "2026-08-10")).toBe(0);
  });
});
