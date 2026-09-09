import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import type { PrayerName } from "@/lib/prayer-times/windows";
import type { SunnahSlot } from "@/lib/deen/sunnah";

/**
 * R5's `core(supabase, userId, ...)` extraction, for real (team-lead, L6
 * brief): the logic `app/(app)/deen/actions.ts`'s cookie-authed Server
 * Actions and `lib/mcp/tools/write.ts`'s bearer-authed MCP tool both call
 * through. NONE of these functions call `requireUser()`, `getProfile()`,
 * or `getAuthedUser()` — that is the one rule that makes this extraction
 * real rather than cosmetic (see `lib/tasks/actions-core.ts` for the
 * cautionary example: named "core", still calls `requireUser()` inside
 * every function, so it would reproduce the exact cookie-auth failure this
 * program's whole R4 spike exists to avoid if anything tried to call it
 * from the MCP side).
 *
 * TIMEZONE IS AN EXPLICIT PARAMETER, NEVER FETCHED HERE — team-lead's
 * explicit instruction, and the reason is testability as much as
 * layering: `markPrayerCore`/`toggleSunnahCore`'s own date-boundary
 * correctness (AGENTS.md's three-incidents-in-one-night rule) is pinned by
 * `__tests__/actions-core.test.ts` calling these functions DIRECTLY with a
 * controlled `now`/`timezone` pair, with zero Supabase mocking needed for
 * the date math itself. `now` is also explicit (never `new Date()` inside
 * this file) for the same reason — a caller (the cookie action, the MCP
 * tool, or a test) supplies the real current instant once, and every
 * function here is a pure-enough function of its own inputs.
 */

export interface MarkPrayerResult {
  id: string;
  date: string;
  prayerName: PrayerName;
  status: "on_time" | "qada" | "missed";
  loggedAt: string;
}

/**
 * Same upsert shape as the original `markPrayer` (app/(app)/deen/actions.ts)
 * — `logged_at` is what `lib/mcp/registry.ts`'s `prayer` entity reads as
 * its `updated_at` stand-in, verified there to be set on every write
 * through this one function. Selects `id, logged_at` back off the upsert
 * so callers (the MCP write tool especially — TOOL-ARCHITECTURE.md's own
 * documented contract is `write(...) -> { id, updated_at }`) have the REAL
 * row id, never a synthesized composite key.
 */
export async function markPrayerCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  date: string,
  prayerName: PrayerName,
  status: "on_time" | "qada" | "missed",
): Promise<MarkPrayerResult> {
  const today = localDateString(now, timezone);
  if (date > today) throw new Error("date cannot be after today");

  const { data, error } = await supabase
    .from("prayers")
    .upsert(
      { user_id: userId, date, prayer_name: prayerName, status, logged_at: now.toISOString() },
      { onConflict: "user_id,date,prayer_name" },
    )
    .select("id, logged_at")
    .single();
  if (error) throw error;
  return { id: data.id, date, prayerName, status, loggedAt: data.logged_at };
}

export interface ToggleSunnahResult {
  id: string;
  date: string;
  prayerName: PrayerName;
  slot: SunnahSlot;
  completed: boolean;
}

export async function toggleSunnahCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  date: string,
  prayerName: PrayerName,
  slot: SunnahSlot,
): Promise<ToggleSunnahResult> {
  const today = localDateString(now, timezone);
  if (date > today) throw new Error("date cannot be after today");

  const { data: existing } = await supabase
    .from("sunnah_logs")
    .select("completed")
    .eq("user_id", userId)
    .eq("date", date)
    .eq("prayer_name", prayerName)
    .eq("slot", slot)
    .maybeSingle();

  const completed = !existing?.completed;
  const { data, error } = await supabase
    .from("sunnah_logs")
    .upsert({ user_id: userId, date, prayer_name: prayerName, slot, completed }, { onConflict: "user_id,date,prayer_name,slot" })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, date, prayerName, slot, completed };
}

export interface ToggleAdhkarResult {
  id: string;
  date: string;
  period: "morning" | "evening";
  completed: boolean;
}

/**
 * No future-date guard — matches the ORIGINAL `toggleAdhkar`'s own
 * behavior exactly (it never had one either); not introducing a new
 * restriction as a side effect of this extraction.
 */
export async function toggleAdhkarCore(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  period: "morning" | "evening",
): Promise<ToggleAdhkarResult> {
  const { data: existing } = await supabase
    .from("adhkar_logs")
    .select("completed")
    .eq("user_id", userId)
    .eq("date", date)
    .eq("period", period)
    .maybeSingle();

  const completed = !existing?.completed;
  const { data, error } = await supabase
    .from("adhkar_logs")
    .upsert({ user_id: userId, date, period, completed }, { onConflict: "user_id,date,period" })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, date, period, completed };
}

/**
 * Fetches ONLY the timezone — explicitly NOT `todayForUser` (actions.ts's
 * own helper, which fetches timezone AND computes "today" in one step):
 * that collapsing is exactly what moves here, into each core function
 * above, so the date math is pinned independent of the DB round trip.
 * Not cookie-coupled — takes `supabase`/`userId` as plain parameters, so
 * both the cookie-authed wrapper and the MCP tool can call it identically.
 */
export async function fetchTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  return data?.timezone ?? "UTC";
}
