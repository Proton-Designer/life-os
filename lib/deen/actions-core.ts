import { frequencyToColumns, normalizeFrequency, type HabitFrequency } from "@/lib/habits/frequency";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import type { PrayerName } from "@/lib/prayer-times/windows";
import type { SunnahSlot } from "@/lib/deen/sunnah";
import type { HabitStage } from "@/lib/deen/habit-stage";
import { ToolNotFoundError } from "@/lib/mcp/tool-input-error";

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

export interface UnlogPrayerResult {
  id: string;
  date: string;
  prayerName: PrayerName;
  status: "unlogged";
  loggedAt: string;
}

/**
 * R9's non-hard-delete "unlog" — the MCP write path's ONLY way to undo a
 * logged prayer. Stores `status: 'unlogged'` instead of deleting the row;
 * `effectivePrayerStatus`/`resolvePrayerStatuses` (lib/deen/prayer-status.ts)
 * are taught to treat an `'unlogged'` row EXACTLY like an absent one, so
 * it falls through to the same window-based re-derivation, never frozen.
 *
 * The app's own `unmarkPrayer` (app/(app)/deen/actions.ts) keeps its real
 * `DELETE` and does NOT call this — deliberately. The no-hard-delete rule
 * is about the ACTOR, not the operation: a person deleting their own row
 * in their own UI is acting on their own data with intent; an MCP call may
 * originate from a model acting on content it was injected with. Both
 * paths converge on the same effective status, so nothing downstream can
 * tell them apart.
 *
 * Same upsert shape and future-date guard as `markPrayerCore` — this is
 * an "unlog", not a "log", but the same "can't unlog a day that hasn't
 * happened yet" reasoning applies (there's nothing to have logged there).
 */
export async function unlogPrayerCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  date: string,
  prayerName: PrayerName,
): Promise<UnlogPrayerResult> {
  const today = localDateString(now, timezone);
  if (date > today) throw new Error("date cannot be after today");

  const { data, error } = await supabase
    .from("prayers")
    .upsert(
      { user_id: userId, date, prayer_name: prayerName, status: "unlogged", logged_at: now.toISOString() },
      { onConflict: "user_id,date,prayer_name" },
    )
    .select("id, logged_at")
    .single();
  if (error) throw error;
  return { id: data.id, date, prayerName, status: "unlogged", loggedAt: data.logged_at };
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
 * SETS (not toggles) the adhkar state -- PERF-2/PERF-1 review F1. The optimistic UI
 * sends its intended value so an ordered queue stays "last tap wins" even after a
 * failed write (a toggle would flip from the unchanged server value). Same
 * no-future-guard behaviour as toggleAdhkarCore.
 */
export async function setAdhkarCore(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  period: "morning" | "evening",
  completed: boolean,
): Promise<ToggleAdhkarResult> {
  const { data, error } = await supabase
    .from("adhkar_logs")
    .upsert({ user_id: userId, date, period, completed }, { onConflict: "user_id,date,period" })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, date, period, completed };
}

/** SETS (not toggles) a sunnah slot -- same reason and future-date guard as toggleSunnahCore. */
export async function setSunnahCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  date: string,
  prayerName: PrayerName,
  slot: SunnahSlot,
  completed: boolean,
): Promise<ToggleSunnahResult> {
  const today = localDateString(now, timezone);
  if (date > today) throw new Error("date cannot be after today");
  const { data, error } = await supabase
    .from("sunnah_logs")
    .upsert({ user_id: userId, date, prayer_name: prayerName, slot, completed }, { onConflict: "user_id,date,prayer_name,slot" })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, date, prayerName, slot, completed };
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

// ---------------------------------------------------------------------------
// P4-06: MCP write coverage. Same extraction rule as everything above — no
// requireUser()/getProfile()/getAuthedUser(), timezone/now always explicit.
// ---------------------------------------------------------------------------

const FK_VIOLATION = "23503";

/** Extracts a Postgres error code the same way lib/promotions/actions-core.ts does — duplicated locally rather than shared, matching that file's own precedent of not factoring this into a cross-domain helper for one switch statement. */
function pgCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export interface QuranSessionLogResult {
  id: string;
  date: string;
  pagesRead: number;
  surah: string | null;
  juz: number | null;
}

/**
 * Unlike the original app action (always "today"), the caller supplies
 * `date` explicitly — the write-registry handler defaults it to
 * localDateString(now, timezone) when the caller omits it (P4-06's own
 * rule), but the core itself takes a real date so an MCP caller CAN log a
 * past day's reading, same "strictly not-after-today" guard as
 * markPrayerCore/toggleSunnahCore for consistency within the domain.
 */
export async function quranSessionLogCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  date: string,
  pages: number,
  surah?: string,
  juz?: number,
): Promise<QuranSessionLogResult> {
  const today = localDateString(now, timezone);
  if (date > today) throw new Error("date cannot be after today");

  const { data, error } = await supabase
    .from("quran_sessions")
    .insert({ user_id: userId, date, pages_read: pages, surah: surah ?? null, juz: juz ?? null })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, date, pagesRead: pages, surah: surah ?? null, juz: juz ?? null };
}

/** Same clamp-at-zero shape as the original adjustQadaBacklog — never negative. */
export async function adjustQadaBacklogCore(supabase: SupabaseClient, userId: string, delta: number): Promise<{ qadaOwed: number }> {
  const { data: profile } = await supabase.from("profiles").select("qada_owed").eq("user_id", userId).maybeSingle();
  const qadaOwed = Math.max(0, (profile?.qada_owed ?? 0) + delta);
  const { error } = await supabase.from("profiles").update({ qada_owed: qadaOwed }).eq("user_id", userId);
  if (error) throw error;
  return { qadaOwed };
}

export async function setTravelingModeCore(supabase: SupabaseClient, userId: string, enabled: boolean): Promise<{ travelingMode: boolean }> {
  const { error } = await supabase.from("profiles").update({ traveling_mode: enabled }).eq("user_id", userId);
  if (error) throw error;
  return { travelingMode: enabled };
}

export interface ReflectionEntryLogResult {
  id: string;
  date: string;
  tier: 1 | 2 | 3;
}

/** Same plain tally insert as the original -- no text/note column, by design (a glance at an expanded note could leak content; a tally count can't). Same explicit-date + not-after-today shape as quranSessionLogCore. */
export async function reflectionEntryLogCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  date: string,
  tier: 1 | 2 | 3,
): Promise<ReflectionEntryLogResult> {
  const today = localDateString(now, timezone);
  if (date > today) throw new Error("date cannot be after today");

  const { data, error } = await supabase.from("reflection_entries").insert({ user_id: userId, date, tier }).select("id").single();
  if (error) throw error;
  return { id: data.id, date, tier };
}

export interface DeenHabit {
  id: string;
  name: string;
  anchorCue: string | null;
  committedDate: string;
}

/** Same trim-to-null normalization as the original — "" is never stored, only null or a real value, so "no cue" and "cue cleared" stay distinguishable. */
function normalizeAnchorCue(anchorCue: string | null | undefined): string | null {
  const trimmed = anchorCue?.trim();
  return trimmed ? trimmed : null;
}

export async function createDeenHabitCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  name: string,
  anchorCue?: string,
  /** HABIT-FREQ: omitted = daily (every existing caller). Validated here, so no write path can store an invalid cadence. */
  frequency?: HabitFrequency,
): Promise<{ id: string }> {
  const committedDate = localDateString(now, timezone);
  const columns = frequencyToColumns(normalizeFrequency(frequency));
  const { data, error } = await supabase
    .from("deen_habits")
    .insert({ user_id: userId, name, committed_date: committedDate, anchor_cue: normalizeAnchorCue(anchorCue), ...columns })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

/**
 * Every action below that targets an EXISTING deen_habits row by id shares
 * this shape: UPDATE ... WHERE id=? AND user_id=?, THEN check rows-affected
 * via .select() rather than a separate pre-check SELECT (a9's ruling,
 * P4-06) — one round trip, not two. The original app actions silently
 * no-op on a bad id; this throws ToolNotFoundError instead, a shared-core
 * behavior change reaching the cookie-authed app path too, judged correct
 * per this codebase's loud-failure-over-silent-success posture (same
 * pattern already established by lib/mcp/tools/read.ts,
 * lib/mcp/tools/widget-manage.ts, lib/scheduling/scheduler-core.ts).
 */
async function requireHabitUpdated(
  supabase: SupabaseClient,
  userId: string,
  habitId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase.from("deen_habits").update(patch).eq("id", habitId).eq("user_id", userId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new ToolNotFoundError(`No deen habit found with id "${habitId}".`);
}

export async function updateDeenHabitCore(supabase: SupabaseClient, userId: string, habitId: string, name: string, anchorCue: string | null): Promise<void> {
  await requireHabitUpdated(supabase, userId, habitId, { name, anchor_cue: normalizeAnchorCue(anchorCue) });
}

/**
 * HABIT-FREQ: change how often a habit is meant to happen. Past logs are untouched (a completion is still one row per
 * date), so switching a habit from daily to "3× a week" simply re-reads its history under the new rule.
 */
export async function setDeenHabitFrequencyCore(supabase: SupabaseClient, userId: string, habitId: string, frequency: HabitFrequency): Promise<void> {
  await requireHabitUpdated(supabase, userId, habitId, frequencyToColumns(normalizeFrequency(frequency)));
}

/** Soft delete via the existing `archived` column — NEVER a hard delete. deen_habit_logs rows are left in place, so history survives an un-archive. */
export async function archiveDeenHabitCore(supabase: SupabaseClient, userId: string, habitId: string): Promise<void> {
  await requireHabitUpdated(supabase, userId, habitId, { archived: true });
}

/** `stage` of null resets to automatic (derived from committed_date) — see lib/deen/habit-stage.ts. */
export async function setDeenHabitStageOverrideCore(supabase: SupabaseClient, userId: string, habitId: string, stage: HabitStage | null): Promise<void> {
  await requireHabitUpdated(supabase, userId, habitId, { stage_override: stage });
}

/**
 * committedDate is REQUIRED, never defaulted to today — unlike the log-style
 * actions above, this action's entire point is setting a date that is
 * usually NOT today (correcting when a habit actually started), so
 * defaulting an omitted value to today would silently do something the
 * caller almost certainly didn't intend.
 */
export async function setDeenHabitCommittedDateCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  habitId: string,
  committedDate: string,
): Promise<void> {
  const today = localDateString(now, timezone);
  if (committedDate > today) throw new Error("committedDate cannot be after today");
  await requireHabitUpdated(supabase, userId, habitId, { committed_date: committedDate });
}

export interface ToggleDeenHabitLogResult {
  habitId: string;
  date: string;
  completed: boolean;
}

/**
 * THE TOGGLE TRAP applies here exactly like toggleSunnahCore/toggleAdhkarCore
 * — reads `completed` then writes its negation, so a retry inverts what the
 * first call already set. deen_habit_logs.habit_id is a composite tenancy FK
 * to deen_habits(user_id, id) (migration 058) — a cross-tenant habit_id is
 * rejected by the database itself; caught here and translated to
 * ToolNotFoundError so a guessed/stale id reaches the caller as a clean,
 * actionable message instead of a raw FK-violation error.
 */
export async function toggleDeenHabitLogCore(supabase: SupabaseClient, userId: string, habitId: string, date: string): Promise<ToggleDeenHabitLogResult> {
  const { data: existing } = await supabase.from("deen_habit_logs").select("completed").eq("habit_id", habitId).eq("date", date).maybeSingle();
  const completed = !existing?.completed;
  const { error } = await supabase.from("deen_habit_logs").upsert({ habit_id: habitId, user_id: userId, date, completed }, { onConflict: "habit_id,date" });
  if (error) {
    if (pgCode(error) === FK_VIOLATION) throw new ToolNotFoundError(`No deen habit found with id "${habitId}".`);
    throw error;
  }
  return { habitId, date, completed };
}

/**
 * SETS (not toggles) — Ayman explicitly asked to "edit status on that habit
 * manually even if it wasnt recorded." Unconditional upsert on the existing
 * (habit_id, date) unique constraint, so it can't produce a duplicate row.
 * Same FK-violation -> ToolNotFoundError translation as
 * toggleDeenHabitLogCore, same future-date guard as the original.
 */
export async function setDeenHabitLogStatusCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  habitId: string,
  date: string,
  completed: boolean,
): Promise<void> {
  const today = localDateString(now, timezone);
  if (date > today) throw new Error("date cannot be after today");

  const { error } = await supabase.from("deen_habit_logs").upsert({ habit_id: habitId, user_id: userId, date, completed }, { onConflict: "habit_id,date" });
  if (error) {
    if (pgCode(error) === FK_VIOLATION) throw new ToolNotFoundError(`No deen habit found with id "${habitId}".`);
    throw error;
  }
}

/**
 * week_start_date is ALWAYS server-computed from now/timezone, never a
 * caller-supplied value — same discipline as the original setWeeklyFocus
 * (never trusts a client-passed date, since it drives the
 * (user_id, week_start_date) uniqueness). Same FK-violation translation as
 * the habit-log cores — deen_weekly_focus.habit_id is also a composite
 * tenancy FK (migration 101).
 */
export async function setWeeklyFocusCore(supabase: SupabaseClient, userId: string, timezone: string, now: Date, habitId: string): Promise<{ weekStartDate: string }> {
  const weekStartDate = getWeekStartDate(localDateString(now, timezone));
  const { error } = await supabase.from("deen_weekly_focus").upsert({ user_id: userId, week_start_date: weekStartDate, habit_id: habitId }, { onConflict: "user_id,week_start_date" });
  if (error) {
    if (pgCode(error) === FK_VIOLATION) throw new ToolNotFoundError(`No deen habit found with id "${habitId}".`);
    throw error;
  }
  return { weekStartDate };
}

/**
 * Mirrors lib/business/actions-core.ts's saveBusinessWeeklyGoalCore exactly
 * — plain upsert, NO locking/carry-forward of the previous week (that step
 * stays in app/(app)/actions.ts's saveWeeklyGoal, the cookie-only wrapper,
 * for both domains alike — the business MCP path has never had it either,
 * so this doesn't introduce a new asymmetry). week_start_date is a
 * caller-supplied patch field, not server-derived, same as business's.
 */
export async function saveDeenWeeklyGoalCore(
  supabase: SupabaseClient,
  userId: string,
  weekStartDate: string,
  headline: string,
  milestones: string[],
  quranPageTarget?: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("weekly_goals")
    .upsert(
      { user_id: userId, week_start_date: weekStartDate, domain: "deen", headline, milestones, quran_page_target: quranPageTarget ?? null },
      { onConflict: "user_id,week_start_date,domain" },
    );
  if (error) throw error;
}
