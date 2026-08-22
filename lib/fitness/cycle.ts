import { addDaysToDateString } from "@/lib/date-utils";

/**
 * 4-week cycles — pure functions, no React, no I/O. The repo's
 * lib/checkins/schedule.ts pattern. docs/superpowers/plans/2026-08-22-fitness-system.md:
 * "Cycle 4 weeks. Benchmarks at each boundary." The anchor (migration 039's
 * fitness_cycle_anchor, one row per user) is stored once — this is a pure
 * function OVER that stored value, same reasoning as
 * lib/checkins/schedule.ts's computeAllocationWindows being pure over the
 * stored wake/sleep bounds.
 *
 * All arithmetic goes through addDaysToDateString, which operates on
 * YYYY-MM-DD calendar strings via Date.UTC — never a local wall-clock
 * instant — so this is DST-safe by construction: there is no timezone
 * lookup anywhere in this file to get wrong.
 */

export const CYCLE_LENGTH_DAYS = 28;

export type Cycle = {
  /** 1-indexed. */
  cycleNumber: number;
  startDate: string;
  /** Inclusive — the cycle's last day. */
  endDate: string;
  /** Inclusive of `dateStr` itself; 0 once `dateStr` is past `endDate`. */
  daysLeft: number;
};

function parseDateStr(dateStr: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!match) return null;
  const [, y, m, d] = match;
  const epochMs = Date.UTC(Number(y), Number(m) - 1, Number(d));
  return Number.isFinite(epochMs) ? epochMs : null;
}

/** Whole calendar days from `fromDateStr` to `toDateStr`; null for either input never crashes, just yields 0 (treated as "no offset"). */
function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = parseDateStr(fromDateStr);
  const to = parseDateStr(toDateStr);
  if (from === null || to === null) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * `dateStr` is assumed to be on/after `anchorDate` — the anchor is always
 * set no later than "today" (defaults to the first plan activation, per
 * the plan's logic-gap resolution #6). A hostile/malformed `dateStr`
 * before the anchor is clamped to the anchor itself (cycle 1, day 1)
 * rather than producing a negative cycle number.
 */
export function cycleForDate(anchorDate: string, dateStr: string): Cycle {
  // A malformed anchor can't be handed to addDaysToDateString below (it
  // does unchecked Date.UTC/.toISOString() and throws on Invalid Date) —
  // fall back to the epoch so garbage input degrades to a garbage-but-safe
  // result instead of crashing the caller.
  const safeAnchor = parseDateStr(anchorDate) !== null ? anchorDate : "1970-01-01";

  const rawOffset = daysBetween(safeAnchor, dateStr);
  const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
  const cycleIndex = Math.floor(offset / CYCLE_LENGTH_DAYS);
  const daysIntoCycle = offset - cycleIndex * CYCLE_LENGTH_DAYS;

  const startDate = addDaysToDateString(safeAnchor, cycleIndex * CYCLE_LENGTH_DAYS);
  const endDate = addDaysToDateString(startDate, CYCLE_LENGTH_DAYS - 1);
  // Computed from the offset arithmetic directly, not a second
  // daysBetween(dateStr, endDate) call — that would use the raw,
  // possibly-before-the-anchor dateStr and disagree with the clamped
  // offset used for cycleIndex above.
  const daysLeft = CYCLE_LENGTH_DAYS - daysIntoCycle;

  return { cycleNumber: cycleIndex + 1, startDate, endDate, daysLeft };
}

/** True in the last N days of the cycle (inclusive) — when the benchmark log becomes due. */
export function isInBenchmarkWindow(cycle: Cycle, windowDays: number = 3): boolean {
  return cycle.daysLeft > 0 && cycle.daysLeft <= windowDays;
}
