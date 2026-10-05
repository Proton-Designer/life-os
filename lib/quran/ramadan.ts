import { addDaysToDateString } from "@/lib/date-utils";

/**
 * QURAN-01: when to offer the Ramadan plan, and when Ramadan ends, from the Umm al-Qura Hijri calendar built into Intl
 * (`islamic-umalqura`); no hard-coded years. The calendar is CALCULATED (the Saudi civil one), so a locally sighted start
 * can differ by a day; the plan's finish date can be edited, so a one-day drift is harmless.
 */

const ISLAMIC = "en-u-ca-islamic-umalqura";
const SHABAN = 8;
const RAMADAN = 9;
const MAX_SCAN_DAYS = 70; // from the start of Sha'ban to the end of Ramadan is at most ~60 days

let formatter: Intl.DateTimeFormat | null | undefined;

function hijriFormatter(): Intl.DateTimeFormat | null {
  if (formatter !== undefined) return formatter;
  try {
    const f = new Intl.DateTimeFormat(ISLAMIC, { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
    formatter = f.resolvedOptions().calendar === "islamic-umalqura" ? f : null; // an engine without the calendar must not be trusted
  } catch {
    formatter = null;
  }
  return formatter;
}

/** The Hijri { year, month (1-12), day } of a local calendar date string, or null when the engine can't say. */
export function hijriOf(localDate: string): { year: number; month: number; day: number } | null {
  const f = hijriFormatter();
  if (!f) return null;
  const [y, m, d] = localDate.split("-").map(Number);
  // The date is already the user's LOCAL calendar day; noon UTC keeps it on that civil date for the conversion.
  const parts = f.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? { year, month, day } : null;
}

export type RamadanWindow = {
  /** True in Sha'ban (the month before) and in Ramadan itself: when the Ramadan plan is worth offering. */
  offer: boolean;
  /** The local date of the LAST day of the coming/current Ramadan; null when not offered. */
  ramadanEnd: string | null;
};

export function ramadanWindow(localDate: string): RamadanWindow {
  const here = hijriOf(localDate);
  if (!here || (here.month !== SHABAN && here.month !== RAMADAN)) return { offer: false, ramadanEnd: null };
  // Walk forward to the first day of Shawwal (month 10); the day before is the last day of Ramadan.
  for (let i = 1; i <= MAX_SCAN_DAYS; i++) {
    const date = addDaysToDateString(localDate, i);
    const h = hijriOf(date);
    if (!h) break;
    if (h.month === 10) return { offer: true, ramadanEnd: addDaysToDateString(date, -1) };
  }
  return { offer: false, ramadanEnd: null };
}
