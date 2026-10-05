/**
 * HABIT-FREQ — how often a habit is meant to happen. ONE pure module shared by both habit systems (Faith
 * `deen_habits` and the identity habits on /habits), so "is this due today", "how is it going this week", the streak,
 * the adherence rate and the decay rate can never disagree between Home, the Faith page, /habits and the weekly views.
 *
 * Client-safe on purpose: no "server-only", no Supabase, no raw `Date` for calendar maths. Every date is a LOCAL
 * YYYY-MM-DD string the caller already resolved with `localDateString(now, tz)`; the arithmetic here is UTC-component
 * arithmetic on those strings (the same idiom as lib/date-utils.ts), never a derivation from an instant.
 *
 * THE MODEL (a habit's cadence is one of five kinds):
 *   daily                 every day (the original and the default; every pre-existing habit is this).
 *   weekdays {days}       fixed days of the week, e.g. Mon/Wed/Fri. 0 = Sunday … 6 = Saturday. Only those days are "due".
 *   per_week {count}      N times in each Sun–Sat week, on whichever days you choose ("3× a week", "once a week").
 *   per_month {count}     N times in each calendar month ("twice a month", "once a month").
 *   every_n_days {interval}  every N days, counted from the LAST completion ("every 3 days", "every 2 weeks" = 14).
 *
 * LOGS DO NOT CHANGE: a completion is still one row per (habit, date). A flexible habit's progress is simply a count
 * of those rows inside a period, so no log schema, no log writer and no log reader had to change to support this.
 */

import { addDaysToDateString, dayOfWeekFromDateString, getWeekStartDate } from "@/lib/date-utils";

export type HabitFrequency =
  | { kind: "daily" }
  | { kind: "weekdays"; days: number[] }
  | { kind: "per_week"; count: number }
  | { kind: "per_month"; count: number }
  | { kind: "every_n_days"; interval: number };

export type HabitFrequencyKind = HabitFrequency["kind"];

export const DAILY: HabitFrequency = { kind: "daily" };

export const FREQUENCY_KINDS: readonly HabitFrequencyKind[] = ["daily", "weekdays", "per_week", "per_month", "every_n_days"];

/** Bounds. They mirror the CHECK constraints in migration 259 — change both together. */
export const PER_WEEK_MAX = 6; // 7 a week is just "daily"
export const PER_MONTH_MAX = 28; // a month always has at least 28 days
export const INTERVAL_MIN = 2; // 1 day is just "daily"
export const INTERVAL_MAX = 365;

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_SHORT = DAY_SHORT;

// ───────────────────────── columns <-> value ─────────────────────────

/** The four nullable/defaulted columns both habit tables carry (migration 259). */
export type FrequencyColumns = {
  frequency_type: HabitFrequencyKind;
  frequency_count: number | null;
  frequency_days: number[] | null;
  frequency_interval: number | null;
};

export function frequencyToColumns(f: HabitFrequency): FrequencyColumns {
  switch (f.kind) {
    case "daily":
      return { frequency_type: "daily", frequency_count: null, frequency_days: null, frequency_interval: null };
    case "weekdays":
      return { frequency_type: "weekdays", frequency_count: null, frequency_days: [...f.days], frequency_interval: null };
    case "per_week":
      return { frequency_type: "per_week", frequency_count: f.count, frequency_days: null, frequency_interval: null };
    case "per_month":
      return { frequency_type: "per_month", frequency_count: f.count, frequency_days: null, frequency_interval: null };
    case "every_n_days":
      return { frequency_type: "every_n_days", frequency_count: null, frequency_days: null, frequency_interval: f.interval };
  }
}

type MaybeColumns = {
  frequency_type?: string | null;
  frequency_count?: number | null;
  frequency_days?: number[] | null;
  frequency_interval?: number | null;
};

/**
 * Stored columns -> a value. LENIENT, never throws: a row from before the migration (columns absent), or one a future
 * manual fix left inconsistent, reads as `daily` — a page render must never crash over a habit's cadence, and "daily"
 * is exactly how every habit behaved before this feature existed.
 */
export function frequencyFromColumns(row: MaybeColumns | null | undefined): HabitFrequency {
  if (!row) return DAILY;
  try {
    return normalizeFrequency(columnsToLooseInput(row));
  } catch {
    return DAILY;
  }
}

function columnsToLooseInput(row: MaybeColumns): unknown {
  switch (row.frequency_type) {
    case "weekdays":
      return { kind: "weekdays", days: row.frequency_days ?? [] };
    case "per_week":
      return { kind: "per_week", count: row.frequency_count };
    case "per_month":
      return { kind: "per_month", count: row.frequency_count };
    case "every_n_days":
      return { kind: "every_n_days", interval: row.frequency_interval };
    default:
      return { kind: "daily" };
  }
}

// ───────────────────────── validation ─────────────────────────

export class FrequencyError extends Error {}

function wholeNumber(v: unknown, label: string, min: number, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new FrequencyError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

/**
 * The single validator every write path uses (server actions, the MCP tools, the editor). Throws `FrequencyError` with a
 * message a person can act on. Returns a CANONICAL value: weekdays sorted/deduped; "every day of the week" collapses to
 * daily; per-week 7 would be daily so it is refused rather than silently stored as something else.
 */
export function normalizeFrequency(input: unknown): HabitFrequency {
  if (input === null || input === undefined) return DAILY;
  if (typeof input !== "object") throw new FrequencyError("Frequency must be an object like { kind: \"per_week\", count: 3 }.");
  const o = input as Record<string, unknown>;
  const kind = o.kind;
  if (kind === undefined || kind === "daily") return DAILY;
  switch (kind) {
    case "weekdays": {
      if (!Array.isArray(o.days) || o.days.length === 0) throw new FrequencyError("Pick at least one day of the week.");
      const days = [...new Set(o.days.map((d) => wholeNumber(d, "A weekday", 0, 6)))].sort((a, b) => a - b);
      return days.length === 7 ? DAILY : { kind: "weekdays", days };
    }
    case "per_week":
      return { kind: "per_week", count: wholeNumber(o.count, "Times per week", 1, PER_WEEK_MAX) };
    case "per_month":
      return { kind: "per_month", count: wholeNumber(o.count, "Times per month", 1, PER_MONTH_MAX) };
    case "every_n_days":
      return { kind: "every_n_days", interval: wholeNumber(o.interval, "Days between", INTERVAL_MIN, INTERVAL_MAX) };
    default:
      throw new FrequencyError(`Unknown frequency "${String(kind)}". Use one of: ${FREQUENCY_KINDS.join(", ")}.`);
  }
}

// ───────────────────────── labels ─────────────────────────

function timesLabel(n: number): string {
  return n === 1 ? "Once" : n === 2 ? "Twice" : `${n}×`;
}

/** Human label, e.g. "Every day", "Mon · Wed · Fri", "3× a week", "Once a month", "Every 2 weeks". */
export function describeFrequency(f: HabitFrequency): string {
  switch (f.kind) {
    case "daily":
      return "Every day";
    case "weekdays": {
      if (f.days.length === 5 && f.days.join() === "1,2,3,4,5") return "Weekdays";
      if (f.days.length === 2 && f.days.join() === "0,6") return "Weekends";
      return f.days.map((d) => DAY_SHORT[d]).join(" · ");
    }
    case "per_week":
      return `${timesLabel(f.count)} a week`;
    case "per_month":
      return `${timesLabel(f.count)} a month`;
    case "every_n_days":
      return f.interval % 7 === 0 ? (f.interval === 7 ? "Every week" : `Every ${f.interval / 7} weeks`) : `Every ${f.interval} days`;
  }
}

/** Short badge text for a dense row; null for daily (the default needs no badge). */
export function frequencyBadge(f: HabitFrequency): string | null {
  return f.kind === "daily" ? null : describeFrequency(f);
}

/**
 * Expected completions per day. This is what makes the identity habit's decaying score fair to a non-daily habit: a
 * weekly habit must not decay 4% a day and read as failing in the six days it was never meant to happen.
 */
export function expectedRatePerDay(f: HabitFrequency): number {
  switch (f.kind) {
    case "daily":
      return 1;
    case "weekdays":
      return f.days.length / 7;
    case "per_week":
      return f.count / 7;
    case "per_month":
      return f.count / 30.4375;
    case "every_n_days":
      return 1 / f.interval;
  }
}

// ───────────────────────── date helpers (string arithmetic) ─────────────────────────

const monthPrefix = (d: string) => d.slice(0, 7); // YYYY-MM
const monthStart = (d: string) => `${monthPrefix(d)}-01`;
function daysInMonth(d: string): number {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
const monthEnd = (d: string) => `${monthPrefix(d)}-${String(daysInMonth(d)).padStart(2, "0")}`;
const weekEnd = (weekStart: string) => addDaysToDateString(weekStart, 6);
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000);
}

type Period = { start: string; end: string };

/** The Sun–Sat week or calendar month containing `date`. */
function periodOf(kind: "per_week" | "per_month", date: string): Period {
  if (kind === "per_week") {
    const start = getWeekStartDate(date);
    return { start, end: weekEnd(start) };
  }
  return { start: monthStart(date), end: monthEnd(date) };
}

function previousPeriod(kind: "per_week" | "per_month", p: Period): Period {
  return periodOf(kind, addDaysToDateString(p.start, -1));
}

function countIn(dates: ReadonlySet<string>, p: Period): number {
  let n = 0;
  for (const d of dates) if (d >= p.start && d <= p.end) n++;
  return n;
}

/**
 * The target for a period, softened for the habit's FIRST (partial) period: a habit committed on a Thursday must not owe
 * a full "5× this week". It owes at most as many completions as it had days left in that period.
 */
function targetFor(count: number, p: Period, committedDate: string): number {
  if (committedDate <= p.start) return count;
  const daysLeft = daysBetween(committedDate, p.end) + 1;
  return Math.max(1, Math.min(count, daysLeft));
}

// ───────────────────────── today's state ─────────────────────────

export type HabitProgress = { done: number; target: number; unit: "week" | "month" } | null;

export type HabitDueState = {
  /** Show it on Home today? Daily: always. Weekdays: only those days. per_week/per_month: until the period's quota is met. every_n_days: once the interval has elapsed. A habit already completed today still shows (ticked). */
  due: boolean;
  doneToday: boolean;
  /** Quota progress for per_week / per_month, else null. */
  progress: HabitProgress;
  /** every_n_days only: the date it next comes due (null for the others). */
  nextDueDate: string | null;
  /** Short status text for a row: "2 of 3 this week", "Next: Thu", "Due again in 2 days", or null when daily needs none. */
  statusText: string | null;
};

export type HabitDueContext = {
  /** Every date the habit was completed (any order; may include dates after today — ignored). */
  completedDates: readonly string[];
  committedDate: string;
};

export function computeDueState(f: HabitFrequency, today: string, ctx: HabitDueContext): HabitDueState {
  const dates = new Set(ctx.completedDates.filter((d) => d <= today));
  const doneToday = dates.has(today);

  switch (f.kind) {
    case "daily":
      return { due: true, doneToday, progress: null, nextDueDate: null, statusText: null };

    case "weekdays": {
      const scheduledToday = f.days.includes(dayOfWeekFromDateString(today));
      return {
        due: scheduledToday || doneToday,
        doneToday,
        progress: null,
        nextDueDate: null,
        statusText: scheduledToday ? null : `Next: ${DAY_SHORT[nextScheduledDow(f.days, today)]}`,
      };
    }

    case "per_week":
    case "per_month": {
      const p = periodOf(f.kind, today);
      const done = countIn(dates, p);
      const target = targetFor(f.count, p, ctx.committedDate);
      const unit = f.kind === "per_week" ? "week" : "month";
      const met = done >= target;
      return {
        due: !met || doneToday,
        doneToday,
        progress: { done, target, unit },
        nextDueDate: null,
        statusText: met ? `Done for this ${unit}` : `${done} of ${target} this ${unit}`,
      };
    }

    case "every_n_days": {
      const last = lastCompletionBefore(dates, today);
      const nextDue = last ? addDaysToDateString(last, f.interval) : ctx.committedDate;
      const due = today >= nextDue || doneToday;
      const wait = daysBetween(today, nextDue);
      return {
        due,
        doneToday,
        progress: null,
        nextDueDate: nextDue,
        statusText: due ? null : wait === 1 ? "Due tomorrow" : `Due again in ${wait} days`,
      };
    }
  }
}

function lastCompletionBefore(dates: ReadonlySet<string>, today: string): string | null {
  let best: string | null = null;
  for (const d of dates) if (d < today && (best === null || d > best)) best = d;
  return best;
}

/** The weekday number (0–6) of the next scheduled day strictly after `today`. */
function nextScheduledDow(days: readonly number[], today: string): number {
  const dow = dayOfWeekFromDateString(today);
  for (let i = 1; i <= 7; i++) {
    const d = (dow + i) % 7;
    if (days.includes(d)) return d;
  }
  return days[0]!;
}

// ───────────────────────── streak ─────────────────────────

export type HabitStreak = { count: number; unit: "day" | "week" | "month" | "in_a_row" };

/**
 * The run the habit is currently on, in the unit that fits its cadence. Never punishes the unfinished present:
 *   daily       consecutive days (an unticked today is skipped, not a break) — identical to the original streak.
 *   weekdays    consecutive SCHEDULED days; days off neither add to nor break the run.
 *   per_week / per_month   consecutive periods that met their quota; the CURRENT period counts if already met, and is
 *               otherwise simply not over yet.
 *   every_n_days  consecutive completions each within N days of the previous; alive only while within N days of the last.
 * No freeze mechanic — a missed scheduled day / unmet period / overlong gap resets it, same rule as the existing streaks.
 */
export function computeFrequencyStreak(f: HabitFrequency, completedDates: readonly string[], today: string, committedDate: string): HabitStreak {
  const dates = new Set(completedDates.filter((d) => d <= today));

  switch (f.kind) {
    case "daily": {
      if (dates.size === 0) return { count: 0, unit: "day" };
      let cursor = dates.has(today) ? today : addDaysToDateString(today, -1);
      let count = 0;
      while (dates.has(cursor)) {
        count++;
        cursor = addDaysToDateString(cursor, -1);
      }
      return { count, unit: "day" };
    }

    case "weekdays": {
      let cursor = today;
      // Today only matters if it is a scheduled day AND done; an unticked scheduled today is "not over yet".
      let count = 0;
      for (let guard = 0; guard < 800; guard++) {
        if (cursor < committedDate) break;
        const scheduled = f.days.includes(dayOfWeekFromDateString(cursor));
        if (scheduled) {
          if (dates.has(cursor)) count++;
          else if (cursor !== today) break;
        }
        cursor = addDaysToDateString(cursor, -1);
      }
      return { count, unit: "in_a_row" };
    }

    case "per_week":
    case "per_month": {
      let p = periodOf(f.kind, today);
      let count = 0;
      // The current period: counts only once met; unmet-but-open does not break the run.
      if (countIn(dates, p) >= targetFor(f.count, p, committedDate)) count++;
      for (let guard = 0; guard < 400; guard++) {
        p = previousPeriod(f.kind, p);
        if (p.end < committedDate) break;
        if (countIn(dates, p) >= targetFor(f.count, p, committedDate)) count++;
        else break;
      }
      return { count, unit: f.kind === "per_week" ? "week" : "month" };
    }

    case "every_n_days": {
      const sorted = [...dates].sort().reverse();
      if (sorted.length === 0) return { count: 0, unit: "in_a_row" };
      // Alive only while still inside the allowed gap since the last completion.
      if (daysBetween(sorted[0]!, today) > f.interval) return { count: 0, unit: "in_a_row" };
      let count = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (daysBetween(sorted[i]!, sorted[i - 1]!) <= f.interval) count++;
        else break;
      }
      return { count, unit: "in_a_row" };
    }
  }
}

/** "5d streak", "3 wk streak", "2 mo streak", "4 in a row". Empty string when there is no run. */
export function streakLabel(s: HabitStreak): string {
  if (s.count <= 0) return "";
  switch (s.unit) {
    case "day":
      return `${s.count}d streak`;
    case "week":
      return `${s.count} wk streak`;
    case "month":
      return `${s.count} mo streak`;
    case "in_a_row":
      return `${s.count} in a row`;
  }
}

// ───────────────────────── adherence over a window ─────────────────────────

export type HabitAdherence = { done: number; total: number; unit: "day" | "week" | "month" | "completion" };

/**
 * "How often did it happen, out of how often it should have" over [windowStart, today], floored at the habit's own
 * committed date. Same rule the daily rate always followed: TODAY can only help, never hurt (an unfinished today is not
 * a miss), and a period still open is not a miss until it ends.
 *   daily       done days / elapsed days            (unchanged from the original rolling rate)
 *   weekdays    done scheduled days / elapsed scheduled days
 *   per_week / per_month   periods that met their quota / periods that have ended (+ the open one if already met)
 *   every_n_days  completions / floor(elapsed days ÷ N)  (never reported above 100%)
 */
export function computeAdherence(f: HabitFrequency, completedDates: readonly string[], windowStart: string, today: string, committedDate: string): HabitAdherence {
  const dates = new Set(completedDates.filter((d) => d <= today));
  const rangeStart = committedDate > windowStart ? committedDate : windowStart;
  const yesterday = addDaysToDateString(today, -1);

  switch (f.kind) {
    case "daily":
    case "weekdays": {
      let done = 0;
      let total = 0;
      for (let cursor = rangeStart; cursor <= yesterday; cursor = addDaysToDateString(cursor, 1)) {
        if (f.kind === "weekdays" && !f.days.includes(dayOfWeekFromDateString(cursor))) continue;
        total++;
        if (dates.has(cursor)) done++;
      }
      const todayScheduled = f.kind === "daily" || f.days.includes(dayOfWeekFromDateString(today));
      if (todayScheduled && dates.has(today)) {
        done++;
        total++;
      }
      return { done, total, unit: "day" };
    }

    case "per_week":
    case "per_month": {
      let done = 0;
      let total = 0;
      let p = periodOf(f.kind, rangeStart);
      for (let guard = 0; guard < 400 && p.start <= today; guard++) {
        const met = countIn(dates, p) >= targetFor(f.count, p, committedDate);
        if (p.end < today) {
          total++;
          if (met) done++;
        } else if (met) {
          done++;
          total++;
        }
        p = periodOf(f.kind, addDaysToDateString(p.end, 1));
      }
      return { done, total, unit: f.kind === "per_week" ? "week" : "month" };
    }

    case "every_n_days": {
      let done = 0;
      for (const d of dates) if (d >= rangeStart && d <= today) done++;
      const span = Math.max(0, daysBetween(rangeStart, yesterday) + 1);
      const total = Math.max(done, Math.floor(span / f.interval));
      return { done, total, unit: "completion" };
    }
  }
}

/** "12/30" for a daily habit (unchanged from the original), with the unit appended for the others: "3/4 wks", "1/2 mos", "3/4 done". */
export function formatAdherence(a: { done: number; total: number; unit?: HabitAdherence["unit"] }): string {
  const base = `${a.done}/${a.total}`;
  switch (a.unit) {
    case "week":
      return `${base} wks`;
    case "month":
      return `${base} mos`;
    case "completion":
      return `${base} done`;
    default:
      return base;
  }
}

// ───────────────────────── 30-day grid cells ─────────────────────────

export type HabitCellStatus = "done" | "in_progress" | "missed" | "not_tracked" | "off_day" | "open";

/**
 * One cell per day for the Faith page's shared consistency grid.
 *   daily / weekdays: as before — done, today-not-yet "in_progress", past "missed"; a weekday habit's unscheduled days are "off_day".
 *   per_week / per_month / every_n_days: a day is "done" if completed, otherwise a neutral "open" — a flexible habit has no
 *   single day it "should" have happened, so painting the others red would be telling the user they failed at nothing.
 */
export function buildFrequencyCells(f: HabitFrequency, completedDates: readonly string[], days: readonly string[], today: string, committedDate: string): { date: string; status: HabitCellStatus }[] {
  const dates = new Set(completedDates);
  return days.map((date) => {
    if (date < committedDate) return { date, status: "not_tracked" };
    if (dates.has(date)) return { date, status: "done" };
    if (f.kind === "daily" || f.kind === "weekdays") {
      if (f.kind === "weekdays" && !f.days.includes(dayOfWeekFromDateString(date))) return { date, status: "off_day" };
      return { date, status: date === today ? "in_progress" : "missed" };
    }
    return { date, status: "open" };
  });
}
