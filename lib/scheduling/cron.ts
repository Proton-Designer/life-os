import { localDateString, resolveLocalTime, addDaysToDateString, dayOfWeekFromDateString } from "@/lib/date-utils";

/**
 * A DELIBERATELY RESTRICTED cron grammar, not a general 5-field parser —
 * "minute hour * * *" (daily at a local clock time) or "minute hour * * D"
 * (weekly, on local weekday D, 0=Sunday). Real cron admits ranges, steps,
 * lists, and day-of-month, all of which correctly-timezone-aware next-
 * occurrence math (DST transitions, ambiguous/skipped local times) is a
 * genuinely nontrivial problem — the kind AGENTS.md's timezone rule exists
 * because this codebase has gotten wrong FOUR separate times already.
 * Reaching for a real cron/timezone library (e.g. `cron-parser`) rather
 * than hand-rolling that generality was the other option; deferred rather
 * than added under this task's own time pressure, since the realistic
 * "worth scheduling" case named throughout this layer's brief — a
 * recurring daily/weekly write at a fixed local time — is fully served by
 * this restricted form, reusing `resolveLocalTime`/`localDateString`, the
 * SAME already-proven timezone-correct primitives the rest of the app
 * uses, rather than a second, differently-tested notion of "what time is
 * it locally."
 *
 * THE STORED STRING IS STILL VALID STANDARD CRON SYNTAX (a real parser
 * would accept every string this module accepts and compute the identical
 * next occurrence) — this is a restriction on what's ACCEPTED, not a
 * different dialect, so swapping in a real parser later needs no data
 * migration, only widening `CRON_PATTERN` and this file's own logic.
 */

export interface ParsedCron {
  minute: number;
  hour: number;
  /** null means every day ("*" in the day-of-week field). 0=Sunday..6=Saturday, matching dayOfWeekFromDateString's own convention. */
  dayOfWeek: number | null;
}

const CRON_PATTERN = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* (\*|[0-6])$/;

export function parseCronExpression(expr: string): ParsedCron | null {
  const match = CRON_PATTERN.exec(expr.trim());
  if (!match) return null;
  return {
    minute: Number(match[1]),
    hour: Number(match[2]),
    dayOfWeek: match[3] === "*" ? null : Number(match[3]),
  };
}

export function isValidCronExpression(expr: string): boolean {
  return parseCronExpression(expr) !== null;
}

/**
 * The next instant this schedule fires, STRICTLY after `after` (never
 * equal to it — a recurring action that just fired must not immediately
 * re-qualify as due on the very next poll tick against the same instant).
 * Bounded to at most 7 iterations (a full week) — never an unbounded loop.
 */
export function computeNextRunAt(cronExpression: string, after: Date, timezone: string): Date {
  const parsed = parseCronExpression(cronExpression);
  if (!parsed) {
    throw new Error(`Not a valid schedule: "${cronExpression}". Expected "MM HH * * *" (daily) or "MM HH * * D" (weekly, D=0-6, 0=Sunday), all in the account's own local time.`);
  }
  const { minute, hour, dayOfWeek } = parsed;
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  let dateStr = localDateString(after, timezone);
  for (let i = 0; i < 8; i++) {
    const candidate = resolveLocalTime(dateStr, timeStr, timezone);
    const dowMatches = dayOfWeek === null || dayOfWeekFromDateString(dateStr) === dayOfWeek;
    if (dowMatches && candidate.getTime() > after.getTime()) return candidate;
    dateStr = addDaysToDateString(dateStr, 1);
  }
  // Unreachable given the grammar above (a valid dayOfWeek 0-6 always
  // recurs within 7 days), but a thrown error beats a function that could
  // ever silently return a stale/undefined instant.
  throw new Error(`Could not compute a next run for "${cronExpression}" within 7 days — this should be unreachable.`);
}
