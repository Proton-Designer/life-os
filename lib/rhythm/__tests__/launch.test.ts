import { describe, expect, it } from "vitest";
import { fullSequenceDays, lastSevenCounts, lastSevenStart, stepSentence } from "../launch";

const c = (itemId: string, checkedDate: string) => ({ itemId, checkedDate });

describe("lastSevenCounts", () => {
  it("counts distinct days in [today-6, today] per item and ignores older / future dates", () => {
    const m = lastSevenCounts(
      [c("a", "2026-10-04"), c("a", "2026-10-03"), c("a", "2026-09-28"), c("a", "2026-09-27"), c("a", "2026-10-05"), c("b", "2026-10-04")],
      "2026-10-04"
    );
    expect(m.get("a")).toBe(3); // 10-04, 10-03, 09-28 (6 days back = inside); 09-27 outside, 10-05 future
    expect(m.get("b")).toBe(1);
  });
  it("counts a duplicate row for one day once", () => {
    expect(lastSevenCounts([c("a", "2026-10-04"), c("a", "2026-10-04")], "2026-10-04").get("a")).toBe(1);
  });
  it("crosses month/year boundaries by calendar days, not string math", () => {
    expect(lastSevenStart("2026-01-03")).toBe("2025-12-28");
    expect(lastSevenCounts([c("a", "2025-12-28"), c("a", "2025-12-27")], "2026-01-03").get("a")).toBe(1);
  });
  it("one missed day costs one day, never the whole number (not a streak)", () => {
    const all = ["2026-10-04", "2026-10-03", "2026-10-01", "2026-09-30", "2026-09-29", "2026-09-28"].map((d) => c("a", d));
    expect(lastSevenCounts(all, "2026-10-04").get("a")).toBe(6); // missed 10-02
  });
});

describe("fullSequenceDays", () => {
  it("counts days where every active step was ticked", () => {
    const checks = [c("a", "2026-10-04"), c("b", "2026-10-04"), c("a", "2026-10-03")];
    expect(fullSequenceDays(checks, ["a", "b"], "2026-10-04")).toBe(1);
    expect(fullSequenceDays(checks, [], "2026-10-04")).toBe(0);
  });
});

describe("stepSentence", () => {
  it("builds 'When <cue>, I <action>' and tolerates a leading 'when'", () => {
    expect(stepSentence({ ifCue: "I sit at my desk", label: "write one line" })).toBe("When I sit at my desk, I write one line");
    expect(stepSentence({ ifCue: "When the kettle boils", label: "stretch" })).toBe("When the kettle boils, I stretch");
    expect(stepSentence({ ifCue: null, label: "Make the bed" })).toBe("Make the bed");
  });
});
