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
  return Array.from({ length: 7 }, (_, i) => {
    const [y, m, d] = weekStart.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + i);
    return date.toISOString().slice(0, 10);
  });
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
