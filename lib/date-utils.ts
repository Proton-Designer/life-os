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
