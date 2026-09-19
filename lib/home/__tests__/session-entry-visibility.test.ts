import { describe, expect, it } from "vitest";
import { shouldShowSessionEntry } from "../session-entry-visibility";

describe("shouldShowSessionEntry", () => {
  it("shows for a real Self-Mastery user regardless of due/new counts", () => {
    expect(shouldShowSessionEntry(true, { dueCount: 0, newCount: 0 })).toBe(true);
    expect(shouldShowSessionEntry(true, null)).toBe(true);
  });

  // The production bug: a School-only user (hasSelfMastery=false) with real due
  // questions was previously invisible because the page discarded dueSummary to
  // null whenever hasSelfMastery was false.
  it("shows for a non-Self-Mastery user with real due items — the #24 fix", () => {
    expect(shouldShowSessionEntry(false, { dueCount: 3, newCount: 0 })).toBe(true);
  });

  it("shows for a non-Self-Mastery user with real new (never-reviewed) items", () => {
    expect(shouldShowSessionEntry(false, { dueCount: 0, newCount: 5 })).toBe(true);
  });

  it("does not show for a non-Self-Mastery user with a genuinely empty dueSummary", () => {
    expect(shouldShowSessionEntry(false, { dueCount: 0, newCount: 0 })).toBe(false);
  });

  it("does not show for a non-Self-Mastery user with no dueSummary at all", () => {
    expect(shouldShowSessionEntry(false, null)).toBe(false);
  });
});
