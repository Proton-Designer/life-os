import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, parseHHMM, resolveLocalTime } from "@/lib/date-utils";

export type DayStart = { localDate: string; wokeAtIso: string };

/**
 * Today's wake mark (#33), or null if Start Day hasn't been tapped yet for
 * the USER'S today. `localDate` is computed here via
 * localDateString(now, timezone) — never `new Date()` alone and never a
 * bare `.toISOString().slice(0,10)` — the same AGENTS.md rule every other
 * "which day is this for" read in this codebase follows (see
 * lib/deen/prayer-status.ts, app/(app)/close/actions.ts).
 */
export async function getTodayDayStart(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date
): Promise<DayStart | null> {
  const localDate = localDateString(now, timezone);
  const { data, error } = await supabase
    .from("day_starts")
    .select("local_date, woke_at")
    .eq("user_id", userId)
    .eq("local_date", localDate)
    .maybeSingle();
  if (error) throw error;
  return data ? { localDate: data.local_date as string, wokeAtIso: data.woke_at as string } : null;
}

/**
 * Wake marks for every `local_date` in `[startDate, endDateExclusive)` —
 * P3-09's Weekly Review closed-vs-open split needs a whole week's worth,
 * not just today's. Keyed by `local_date` (a date string, matching the
 * column's own storage — `startDate`/`endDateExclusive` are the caller's
 * already-resolved local calendar dates, same as every other range query
 * in this codebase, never raw `Date` bounds).
 */
export async function getDayStartsForRange(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDateExclusive: string
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("day_starts")
    .select("local_date, woke_at")
    .eq("user_id", userId)
    .gte("local_date", startDate)
    .lt("local_date", endDateExclusive);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.local_date as string, row.woke_at as string]));
}

/**
 * Idempotent Start Day tap (#33). "Tapping twice on the same local day does
 * not create a second mark or move the first" is a DATABASE guarantee, not
 * an app-layer one: `day_starts` has a `unique (user_id, local_date)`
 * constraint (migration TBD, pending Opus Lead allocation), and this
 * upserts with `ignoreDuplicates: true` — PostgREST's `INSERT ... ON
 * CONFLICT (user_id, local_date) DO NOTHING` — rather than a plain
 * `.insert()` (which would throw 23505 on a second tap) or a plain
 * `.upsert()` without ignoreDuplicates (which would silently overwrite
 * `woke_at` on every re-tap, moving the mark forward every time the page
 * is revisited — exactly the behavior "does not move the first" forbids).
 * This makes the guarantee hold under a genuine race (two rapid taps, a
 * doubled network retry) too, not just under a single read-then-write.
 *
 * `ignoreDuplicates: true` means PostgREST does not return the pre-existing
 * row on a conflict (nothing was written for it), so the winning row —
 * whichever tap actually created it — is always read back afterward rather
 * than trusted from this call's own return value.
 */
export async function markDayStarted(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  /**
   * "I woke earlier than I tapped": the wake instant to record INSTEAD of `now`. Only meaningful for the FIRST mark of a
   * local day -- the table has no update policy (migration 153), so an existing mark is never moved by this or anything
   * else. Callers get it from `resolveWakeInstant`, which refuses a future time.
   */
  wokeAt: Date = now
): Promise<DayStart> {
  const localDate = localDateString(now, timezone);
  const { error } = await supabase.from("day_starts").upsert(
    { user_id: userId, local_date: localDate, woke_at: wokeAt.toISOString() },
    { onConflict: "user_id,local_date", ignoreDuplicates: true }
  );
  if (error) throw error;

  const existing = await getTodayDayStart(supabase, userId, timezone, now);
  if (!existing) {
    // Unreachable given the upsert above succeeded without error — the row
    // for (userId, localDate) either already existed or was just created.
    // Thrown rather than silently falling back to `now`, which would be
    // exactly the "unlogged read as absent, but the caller invents a value
    // anyway" bug class effectivePrayerStatus's comment (lib/deen/
    // prayer-status.ts) warns about, applied to a timestamp instead of a
    // status.
    throw new Error("day_starts row missing immediately after a successful upsert");
  }
  return existing;
}

export type WakeInstantResult = { ok: true; at: Date } | { ok: false; message: string };

/**
 * A wake time of day ("HH:MM", local) -> the instant on the caller's local TODAY. Refuses a malformed value and a time
 * that hasn't happened yet (you cannot have woken at a future time). The date is always local today, never derived from a
 * raw Date: `localDateString(now, tz)` + `resolveLocalTime`, the app's rule.
 */
export function resolveWakeInstant(hhmm: string, timezone: string, now: Date): WakeInstantResult {
  if (!parseHHMM(hhmm) || !/^\d{2}:\d{2}$/.test(hhmm)) return { ok: false, message: "Enter a valid wake time." };
  const at = resolveLocalTime(localDateString(now, timezone), hhmm, timezone);
  if (at.getTime() > now.getTime()) return { ok: false, message: "That time hasn't happened yet today." };
  return { ok: true, at };
}

