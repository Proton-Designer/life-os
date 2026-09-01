import { describe, expect, it } from "vitest";
import { startTimer, pauseTimer, resumeTimer, elapsedMs } from "../timer";

describe("timer", () => {
  it("accumulates elapsed time while running", () => {
    const t = startTimer(1000);
    expect(elapsedMs(t, 4000)).toBe(3000);
  });

  it("excludes time while paused (backgrounded)", () => {
    let t = startTimer(0);
    t = pauseTimer(t, 5000); // 5s counted
    // 10s of "backgrounded" time passes, not counted
    t = resumeTimer(t, 15000);
    expect(elapsedMs(t, 20000)).toBe(10000); // 5s + 5s, the 10s gap excluded
  });

  it("pausing twice in a row is a no-op the second time", () => {
    let t = startTimer(0);
    t = pauseTimer(t, 3000);
    const paused = pauseTimer(t, 9000);
    expect(elapsedMs(paused, 20000)).toBe(3000);
  });

  it("resuming twice in a row is a no-op the second time", () => {
    let t = startTimer(0);
    t = resumeTimer(t, 5000); // already running, no-op
    expect(elapsedMs(t, 10000)).toBe(10000);
  });
});
