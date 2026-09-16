import type { HourRecap, HourWorkInterval, ReflectionCard } from "@/lib/reflection-cards/types";

/**
 * P3-05 -- recap step of the End-of-Hour ritual (recap -> card rotation ->
 * submit). Deliberately a fresh, from-scratch summary over already-fetched
 * rows for the last 60 real minutes, NOT a reuse of the allocation-window
 * or Lock-In session-checkin engines' own window math (autonomy-contract
 * design decision, logged in OPEN_QUESTIONS.md's own [P3-05] entry) --
 * this is a small, off-by-default, manually-triggered feature and those
 * two engines are both production-critical; sharing their window math
 * would mean a P3-05 bug or edge case can touch code that must not break.
 */
export function computeHourRecapCore(intervals: readonly HourWorkInterval[]): HourRecap {
  const byDomain: Record<string, number> = {};
  let totalMinutes = 0;
  let workMinutes = 0;
  let distractionCount = 0;

  for (const interval of intervals) {
    totalMinutes += interval.minutes;
    if (interval.isDistraction) {
      distractionCount++;
      continue;
    }
    workMinutes += interval.minutes;
    byDomain[interval.domain] = (byDomain[interval.domain] ?? 0) + interval.minutes;
  }

  return { totalMinutes, workMinutes, distractionCount, byDomain };
}

/**
 * Rotation rule (autonomy-contract design decision): oldest-`lastShownAt`-
 * first, simple and deterministic. A never-shown card (`lastShownAt: null`)
 * counts as older than any real timestamp, so a brand-new card is always
 * seen at least once before the rotation revisits an already-shown one.
 * Archived (`active: false`) cards are never eligible -- filtered here, not
 * left to the caller, so a caller can't accidentally show a retired card by
 * forgetting its own filter.
 */
export function pickNextCardCore(cards: readonly ReflectionCard[]): ReflectionCard | null {
  const eligible = cards.filter((c) => c.active);
  if (eligible.length === 0) return null;

  return eligible.reduce((oldest, candidate) => {
    if (oldest.lastShownAt === null) return oldest;
    if (candidate.lastShownAt === null) return candidate;
    return candidate.lastShownAt < oldest.lastShownAt ? candidate : oldest;
  });
}
