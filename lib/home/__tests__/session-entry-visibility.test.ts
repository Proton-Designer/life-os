import { describe, expect, it } from "vitest";
import { shouldShowSessionEntry } from "../session-entry-visibility";

describe("shouldShowSessionEntry", () => {
  it("shows for a real Self-Mastery user regardless of due/new counts", () => {
    expect(shouldShowSessionEntry(true, { dueCount: 0, newCount: 0, starterDeckMissing: true })).toBe(true);
    expect(shouldShowSessionEntry(true, null)).toBe(true);
  });

  // The production bug: a School-only user (hasSelfMastery=false) with real due
  // questions was previously invisible because the page discarded dueSummary to
  // null whenever hasSelfMastery was false.
  it("shows for a non-Self-Mastery user with real due items — the #24 fix", () => {
    expect(shouldShowSessionEntry(false, { dueCount: 3, newCount: 0, starterDeckMissing: false })).toBe(true);
  });

  it("shows for a non-Self-Mastery user with real new (never-reviewed) items", () => {
    expect(shouldShowSessionEntry(false, { dueCount: 0, newCount: 5, starterDeckMissing: false })).toBe(true);
  });

  // The subtle case this whole extraction exists to pin down: starterDeckMissing
  // is ALSO true for someone who never touched Self-Mastery at all (zero books,
  // zero due, zero new) — showing the entry card there would surface "Your
  // starter deck didn't load" to someone who never wanted a starter deck.
  it("does NOT show for a non-Self-Mastery user whose dueSummary happens to have starterDeckMissing=true", () => {
    expect(shouldShowSessionEntry(false, { dueCount: 0, newCount: 0, starterDeckMissing: true })).toBe(false);
  });

  it("does not show for a non-Self-Mastery user with a genuinely empty dueSummary", () => {
    expect(shouldShowSessionEntry(false, { dueCount: 0, newCount: 0, starterDeckMissing: false })).toBe(false);
  });

  it("does not show for a non-Self-Mastery user with no dueSummary at all", () => {
    expect(shouldShowSessionEntry(false, null)).toBe(false);
  });
});
