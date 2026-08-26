import { computePrayerWindows, PRAYER_NAMES, type PrayerName, type PrayerWindow } from "@/lib/prayer-times/windows";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { localDateString, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";

export type StoredPrayerStatus = "on_time" | "qada" | "missed";
export type EffectivePrayerStatus = "upcoming" | "pending" | "on_time" | "qada" | "missed";

/**
 * The "don't derive missed before this date" floor `resolvePrayerStatuses`
 * takes as `accountCreatedDateStr` — computed here once so its three
 * call sites (deen/page.tsx, lib/home/get-domain-snapshots.ts,
 * app/(app)/deen/salah-calendar-actions.ts) can't drift into three
 * different answers.
 *
 * `tracking_started_on` (migration 051, Opus Lead ruling correcting R7)
 * wins when set. It exists because `profiles.created_at` — a user's real
 * signup date — is the wrong floor once prayer history has been wiped:
 * deleting every `prayers` row without also moving this floor would read
 * every day since signup as 5/5 missed, reconstructing exactly the false
 * history a wipe is meant to remove. Falls back to `created_at`'s local
 * date for any account that never gets `tracking_started_on` set (a fresh
 * signup, or an account from before this column existed).
 *
 * `tracking_started_on` is a plain Postgres `date` — already a calendar
 * date, not an instant — and is used as-is. Routing it through
 * `new Date(...)` + `localDateString` (the treatment `created_at`, a real
 * timestamp, needs) would parse it as UTC midnight and re-localize it a
 * day backward in any timezone behind UTC — the exact inverse-bug case
 * AGENTS.md calls out.
 */
export function computeTrackingFloorDateStr(
  profile: { tracking_started_on: string | null; created_at: string } | null,
  timezone: string,
  now: Date
): string {
  if (profile?.tracking_started_on) return profile.tracking_started_on;
  return localDateString(profile?.created_at ? new Date(profile.created_at) : now, timezone);
}

/**
 * Derived at read time, never written on read (no cron, no race with a
 * user's tap, correct the instant a window closes). A stored status always
 * wins — the user's own record is the truth and derivation only fills
 * silence. `window === null` (no location set, or a high-latitude date
 * where the prayer's angle is unreachable) must never derive `missed`.
 */
export function effectivePrayerStatus(
  stored: StoredPrayerStatus | null,
  window: PrayerWindow | null,
  now: Date
): EffectivePrayerStatus {
  if (stored) return stored;
  if (window === null) return "pending";
  if (now.getTime() >= window.end.getTime()) return "missed";
  if (now.getTime() >= window.start.getTime()) return "pending";
  return "upcoming";
}

export type PrayerRowLike = { date: string; prayer_name: string; status: string };

export type ResolvedDayStatuses = Record<PrayerName, EffectivePrayerStatus>;

/**
 * The one shared ripple point: every consumer of raw prayers.status (Deen's
 * own page, Home's priority items/snapshots, the consistency grid, the
 * streak) routes through this instead of re-deriving the logic per site.
 * Floored at `accountCreatedDateStr` (profiles.created_at's local date) —
 * dates before it never derive `missed`, even with no rows and a window
 * that would otherwise read as closed.
 */
export function resolvePrayerStatuses(opts: {
  rows: PrayerRowLike[];
  dates: string[];
  lat: number | null;
  lng: number | null;
  timezone: string;
  calcMethod: CalcMethod;
  asrMadhab: AsrMadhab;
  now: Date;
  accountCreatedDateStr: string;
}): Record<string, ResolvedDayStatuses> {
  const { rows, dates, lat, lng, timezone, calcMethod, asrMadhab, now, accountCreatedDateStr } = opts;
  const hasLocation = lat != null && lng != null;
  const result: Record<string, ResolvedDayStatuses> = {};

  // Isha's window extends to the *next* day's Fajr (its outer bound — see
  // computePrayerWindows), so any date at or before T-2 has EVERY window
  // structurally closed no matter what real windows would say: the latest
  // of them ended at that date+1's Fajr, which is at or before T-1. No
  // astronomy needed to know that. Only T-1 and T (or later) can still have
  // a window open relative to `now`. This is exact, not an approximation —
  // it changes zero outputs — and it collapses a 60-date resolve from ~120
  // astronomical solves (computePrayerWindows computes two days internally)
  // down to ~2.
  const todayStr = localDateString(now, timezone);
  const twoDaysAgoStr = addDaysToDateString(todayStr, -2);

  for (const date of dates) {
    const withinFloor = date >= accountCreatedDateStr;
    const definitelyClosed = hasLocation && withinFloor && date <= twoDaysAgoStr;

    const dayResult = {} as ResolvedDayStatuses;

    if (definitelyClosed) {
      for (const name of PRAYER_NAMES) {
        const row = rows.find((r) => r.date === date && r.prayer_name === name);
        const stored = (row?.status as StoredPrayerStatus | undefined) ?? null;
        dayResult[name] = stored ?? "missed";
      }
    } else {
      // computePrayerWindows now derives its own local calendar day from a
      // real instant + timezone (2026-08-25 fix) — noon local is a safely
      // mid-day instant for `date` regardless of DST/offset sign, unlike a
      // UTC-midnight stand-in, which the function would now re-derive as
      // the PREVIOUS local day in any timezone behind UTC.
      const windows =
        withinFloor && hasLocation
          ? computePrayerWindows({ date: resolveLocalTime(date, "12:00", timezone), lat, lng, timezone, calcMethod, asrMadhab })
          : null;
      for (const name of PRAYER_NAMES) {
        const row = rows.find((r) => r.date === date && r.prayer_name === name);
        const stored = (row?.status as StoredPrayerStatus | undefined) ?? null;
        dayResult[name] = effectivePrayerStatus(stored, windows ? windows[name] : null, now);
      }
    }

    result[date] = dayResult;
  }

  return result;
}
