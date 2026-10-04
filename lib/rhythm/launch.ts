/**
 * Launch-sequence arithmetic (IA-P4a). Pure and client-safe. "x of the last 7" is a COUNT of
 * distinct local days a step was ticked in [today-6, today] — never a streak, so one missed day
 * costs one day, not the whole number (the product premise: forgiving, not punishing).
 */
import { addDaysToDateString } from "@/lib/date-utils";

export const MAX_LAUNCH_STEPS = 5;
export const LAST_N_DAYS = 7;

function dayNumber(dateStr: string): number {
  // Pure calendar arithmetic on a YYYY-MM-DD string at noon UTC (no zone involved).
  return Math.floor(new Date(`${dateStr}T12:00:00Z`).getTime() / 86_400_000);
}

/** Start date (inclusive) of the 7-day window ending `today`. */
export function lastSevenStart(today: string): string {
  return addDaysToDateString(today, -(LAST_N_DAYS - 1));
}

/** itemId → number of distinct days (0..7) it was checked in the window ending `today`. Dates outside the window (or future) are ignored. */
export function lastSevenCounts(checks: readonly { itemId: string; checkedDate: string }[], today: string): Map<string, number> {
  const t = dayNumber(today);
  const seen = new Map<string, Set<string>>();
  for (const c of checks) {
    const diff = t - dayNumber(c.checkedDate);
    if (diff < 0 || diff > LAST_N_DAYS - 1) continue;
    const set = seen.get(c.itemId) ?? new Set<string>();
    set.add(c.checkedDate);
    seen.set(c.itemId, set);
  }
  return new Map([...seen].map(([id, set]) => [id, set.size]));
}

/** Days in the window on which EVERY active step was ticked (0 when there are no steps). */
export function fullSequenceDays(
  checks: readonly { itemId: string; checkedDate: string }[],
  activeItemIds: readonly string[],
  today: string
): number {
  if (activeItemIds.length === 0) return 0;
  const t = dayNumber(today);
  const byDay = new Map<string, Set<string>>();
  for (const c of checks) {
    const diff = t - dayNumber(c.checkedDate);
    if (diff < 0 || diff > LAST_N_DAYS - 1) continue;
    const set = byDay.get(c.checkedDate) ?? new Set<string>();
    set.add(c.itemId);
    byDay.set(c.checkedDate, set);
  }
  let n = 0;
  for (const set of byDay.values()) if (activeItemIds.every((id) => set.has(id))) n++;
  return n;
}

/** "When <cue>, I <action>" — the cue is optional; a plain step is just the action. */
export function stepSentence(step: { ifCue: string | null; label: string }): string {
  const cue = step.ifCue?.trim();
  return cue ? `When ${cue.replace(/^when\s+/i, "")}, I ${step.label.trim()}` : step.label.trim();
}
