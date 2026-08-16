import { describe, expect, it } from "vitest";
import { formatDeadlineLabel } from "../deadline-label";

describe("formatDeadlineLabel", () => {
  it("is Overdue/negative for a due date before today", () => {
    expect(formatDeadlineLabel("2026-08-14", "2026-08-15")).toEqual({ label: "Overdue", variant: "negative" });
  });

  it("is Due today/warning for today's date", () => {
    expect(formatDeadlineLabel("2026-08-15", "2026-08-15")).toEqual({ label: "Due today", variant: "warning" });
  });

  it("is a relative day count/neutral for a future date", () => {
    expect(formatDeadlineLabel("2026-08-16", "2026-08-15")).toEqual({ label: "Tomorrow", variant: "neutral" });
    expect(formatDeadlineLabel("2026-08-20", "2026-08-15")).toEqual({ label: "In 5 days", variant: "neutral" });
  });
});
