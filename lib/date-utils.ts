/** YYYY-MM-DD for `now` in the given IANA timezone (day boundary = midnight local, per spec). */
export function localDateString(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function localWeekday(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(now);
}

/** "Fri, Aug 15" for the Topbar's date display, in the given IANA timezone. */
export function formatTopbarDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now);
}

/**
 * "41m" / "13h" / "2d" — a duration's magnitude only, no direction/framing.
 * Every card caption and countdown should route through this (or
 * formatRelativeDuration below) rather than hand-rolling "778 min" style
 * output, per the 2026-08-15 structural refactor review.
 */
export function formatDurationMagnitude(minutes: number): string {
  const magnitude = Math.round(Math.abs(minutes));
  if (magnitude < 60) return `${magnitude}m`;
  if (magnitude < 1440) {
    const hours = Math.round(magnitude / 60);
    // 23h59m rounds to 24h, which must roll over into 1d instead.
    return hours >= 24 ? "1d" : `${hours}h`;
  }
  return `${Math.round(magnitude / 1440)}d`;
}

/** "13h overdue" / "in 45m" / "now" (within a 1-minute margin either way). */
export function formatRelativeDuration(diffMinutes: number): string {
  const rounded = Math.round(diffMinutes);
  if (Math.abs(rounded) <= 1) return "now";
  const magnitude = formatDurationMagnitude(rounded);
  return rounded < 0 ? `${magnitude} overdue` : `in ${magnitude}`;
}

/**
 * Like formatRelativeDuration, but for a WINDOW rather than a hard
 * deadline (currently: an open prayer window) — `dueAt` is when the
 * window opens, `windowEndAt` is when it closes. Once the window has
 * opened (dueAt has passed) but hasn't closed yet, plain
 * formatRelativeDuration(dueAt - now) reads as "2h overdue," which is
 * backwards: the prayer isn't late, it has 2 hours left to be prayed.
 * This instead reports "2h left" (time until windowEndAt) for exactly
 * that in-between state, and falls back to formatRelativeDuration's
 * usual "in Xh" / "Xh overdue" / "now" everywhere else (before the
 * window opens, or if windowEndAt is unknown/already passed).
 */
export function formatWindowRelativeTime(dueAt: Date | null, windowEndAt: Date | null, now: Date): string {
  if (!dueAt) return "Today";
  const startDiffMin = (dueAt.getTime() - now.getTime()) / 60_000;
  if (startDiffMin <= 1 && windowEndAt) {
    const remainingMin = (windowEndAt.getTime() - now.getTime()) / 60_000;
    if (remainingMin > 1) return `${formatDurationMagnitude(remainingMin)} left`;
  }
  const formatted = formatRelativeDuration(startDiffMin);
  return formatted === "now" ? "Now" : formatted;
}

/** Sunday of the week containing `dateStr` (week boundary = Sunday–Saturday, per spec). */
export function getWeekStartDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

/** 0 (Sunday) – 6 (Saturday) for a YYYY-MM-DD string, matching workout_schedule's convention. */
export function dayOfWeekFromDateString(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The 7 YYYY-MM-DD dates (Sun–Sat) for the week starting at `weekStart`. */
export function weekDatesFrom(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDateString(weekStart, i));
}

/**
 * Every date string (YYYY-MM-DD) for a given calendar year/month — pure
 * calendar arithmetic on integers the caller already resolved through a
 * timezone (e.g. `localDateString`'s own year/month), not a derivation
 * from "now" itself, so this doesn't carry the AGENTS.md instant+timezone
 * risk: a Gregorian month's length is a calendrical fact, not something
 * that depends on which timezone is asking.
 */
export function datesInMonth(year: number, month: number): string[] {
  const dayCount = new Date(year, month, 0).getDate();
  return Array.from({ length: dayCount }, (_, i) => {
    const day = i + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

/** `dateStr` shifted by `delta` calendar days (may be negative), as YYYY-MM-DD. */
export function addDaysToDateString(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Resolves a local "HH:MM" clock time on `dateStr` (in `timezone`) to a UTC Date. */
export function resolveLocalTime(dateStr: string, timeStr: string, timezone: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const naiveUtc = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offsetMinutes = getTimezoneOffsetMinutes(naiveUtc, timezone);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000);
}

/** Minutes to add to a UTC instant to get local clock time in `timezone` (handles DST). */
export function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return (asUtc - date.getTime()) / 60_000;
}
