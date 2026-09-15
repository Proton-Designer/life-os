import { describe, expect, it } from "vitest";
import { buildDayConnectionUserMessage, normalizeDayConnection } from "@/app/(app)/personal/closer-day-connection-actions";

describe("buildDayConnectionUserMessage", () => {
  it("lists each due item with its domain", () => {
    const msg = buildDayConnectionUserMessage("What is spaced repetition?", "Reviewing at increasing intervals.", [
      { title: "Problem Set 3", domain: "school" },
      { title: "Submit expense report", domain: "co_op" },
    ]);
    expect(msg).toMatch(/Problem Set 3 \(school\)/);
    expect(msg).toMatch(/Submit expense report \(co_op\)/);
    expect(msg).toMatch(/What is spaced repetition\?/);
  });

  it("renders a domain-less item without a trailing empty parenthesis", () => {
    const msg = buildDayConnectionUserMessage("Q", "A", [{ title: "Call the dentist", domain: null }]);
    expect(msg).toMatch(/- Call the dentist$/m);
    expect(msg).not.toMatch(/\(\)/);
  });

  it("is honest about an empty list rather than pretending nothing was asked", () => {
    const msg = buildDayConnectionUserMessage("Q", "A", []);
    expect(msg).toMatch(/nothing due today/);
  });
});

describe("normalizeDayConnection", () => {
  it("passes through a genuine one-liner", () => {
    expect(normalizeDayConnection("This connects directly to Problem Set 3.")).toBe(
      "This connects directly to Problem Set 3."
    );
  });

  it("returns null for the model's explicit NONE", () => {
    expect(normalizeDayConnection("NONE")).toBeNull();
    expect(normalizeDayConnection("none.")).toBeNull();
    expect(normalizeDayConnection("  None  ")).toBeNull();
  });

  it("returns null for an empty or whitespace-only reply", () => {
    expect(normalizeDayConnection("")).toBeNull();
    expect(normalizeDayConnection("   ")).toBeNull();
  });

  // A forced/invented connection is worse than none -- but this function's
  // OWN job is only format hygiene (trim, take the first line, reject a
  // suspiciously long reply as the model ignoring the one-sentence rule);
  // whether the connection is genuine is the model's call via the NONE
  // instruction, not something regex can judge.
  it("takes only the first line, and rejects a reply far longer than one real sentence", () => {
    expect(normalizeDayConnection("First line.\nSecond line the model shouldn't have added.")).toBe("First line.");
    expect(normalizeDayConnection("x".repeat(221))).toBeNull();
  });
});
