import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { ToolNotFoundError } from "@/lib/mcp/tool-input-error";

type TypedClient = SupabaseClient<Database>;

/** Mirrors identity_habits_rank_per_user_idx (migration 175) -- restated here only so a caller reads the ceiling without opening the migration. */
import { MAX_ACTIVE_HABITS } from "./constants";
export { MAX_ACTIVE_HABITS };
import { killRequiresReason } from "./kill-escalation";

export type Habit = {
  id: string;
  identityStatement: string;
  rank: number;
  createdAt: string;
};

type HabitRow = { id: string; identity_statement: string; rank: number; created_at: string };

function toHabit(row: HabitRow): Habit {
  return { id: row.id, identityStatement: row.identity_statement, rank: row.rank, createdAt: row.created_at };
}

/**
 * #39 — creates an identity habit, auto-assigning the lowest free rank in
 * [1, MAX_ACTIVE_HABITS]. Ranks here are an internal slot number for the
 * scarcity ceiling, not a user-facing priority order the way Goals' rank is
 * (lib/goals/actions-core.ts's createGoal takes an explicit user-chosen
 * rank 1-5) -- the spec is "up to 7 habits," nobody picks a slot number.
 *
 * THE CEILING IS `identity_habits_rank_per_user_idx`, NOT this function's
 * pre-check -- same discipline as createGoal/165. The pre-check below
 * exists only to produce an honest "all 7 are full" error instead of a raw
 * 23505 in the common case; a genuine race between two tabs still gets
 * correctly refused by the database's partial unique index, surfaced here
 * as a normal Postgres error the caller can inspect (`code === "23505"`).
 *
 * P3-07 (migration 202) widened that index to `where status in ('active',
 * 'paused')` -- pausing keeps a habit's rank slot (it is not archiving), so
 * a PAUSED habit's rank is just as occupied as an active one's. The
 * pre-check below must read both statuses, or it can compute a "free" rank
 * that is actually held by a paused habit and crash the insert on the DB's
 * own unique violation instead of giving the honest ceiling message. Fixed
 * as a P3-07 blocking finding from Sonnet ENG 1's own review of that task
 * (mixed active+paused repro, red-first regression test in
 * lib/habits/__tests__/actions-core.test.ts).
 */
export async function createIdentityHabitCore(supabase: TypedClient, userId: string, identityStatement: string): Promise<Habit> {
  const trimmed = identityStatement.trim();
  if (!trimmed) {
    throw new Error("An identity habit needs a statement.");
  }

  const { data: occupied, error: selectError } = await supabase
    .from("identity_habits")
    .select("rank")
    .eq("user_id", userId)
    .in("status", ["active", "paused"]);
  if (selectError) throw selectError;

  const usedRanks = new Set((occupied ?? []).map((r) => r.rank as number));
  let nextRank: number | null = null;
  for (let r = 1; r <= MAX_ACTIVE_HABITS; r++) {
    if (!usedRanks.has(r)) {
      nextRank = r;
      break;
    }
  }
  if (nextRank === null) {
    throw new Error(`You already have ${MAX_ACTIVE_HABITS} active or paused habits — archive one before adding another.`);
  }

  const { data, error } = await supabase
    .from("identity_habits")
    .insert({ user_id: userId, identity_statement: trimmed, rank: nextRank })
    .select("id, identity_statement, rank, created_at")
    .single();
  if (error) throw error;
  return toHabit(data as HabitRow);
}

/**
 * Archives a habit, releasing its rank (the partial unique index is scoped
 * to `status = 'active'`, same mechanism `dropGoal`/165 rely on). Scoped
 * `.eq("status", "active")` on the write itself, same shape as
 * completeGoal/dropGoal (lib/goals/actions-core.ts) -- a stale/foreign/
 * already-archived id simply matches zero rows rather than erroring, and no
 * pre-existence check is made (this codebase's established convention for
 * this exact shape of scoped state transition).
 *
 * Pause/freeze/resume and kill-habit escalation (source spec's own list)
 * are explicitly Phase 2+ per the ruling -- archiving here is one-way in
 * this slice; there is no un-archive action.
 */
export async function archiveIdentityHabitCore(supabase: TypedClient, userId: string, habitId: string): Promise<void> {
  const { error } = await supabase
    .from("identity_habits")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", habitId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
}

/**
 * P3-07 -- pauses a habit: status flips to 'paused' (keeping its rank slot,
 * migration 202's own widened partial unique index) and opens a new row in
 * `identity_habit_pauses` (paused_at = the caller's own local today),
 * which `getActiveHabitsWithVotes`'s score computation later excludes from
 * decay for as long as the pause stays open -- see decay-score.ts's
 * `computeHabitDecayScore` and migration 202's header for the full
 * product reasoning ("pause freezes the score").
 *
 * STATUS UPDATE FIRST, THEN THE PAUSE-LOG ROW -- the safer of the two
 * failure directions if something goes wrong between them: if the log
 * insert fails after the status flip succeeds, the habit at least VISIBLY
 * shows as paused (matching what the user just did), even though that one
 * pause window's days won't be excluded from decay until whatever caused
 * the insert failure is fixed. The reverse order (log row first, status
 * second) would risk an ORPHAN pause window nobody's UI reflects while
 * silently already affecting future decay math -- a wrong number the user
 * has no visible reason to suspect, which is worse than a cosmetic status
 * lag they can retry.
 *
 * Same "scoped .eq(status,'active') on the write, no pre-existence check,
 * a stale/foreign/already-paused id simply matches zero rows" shape as
 * `archiveIdentityHabitCore` -- except this DOES need to know whether the
 * update actually matched a row, to decide whether opening a pause-log
 * entry is warranted at all (a no-op status update should open no window).
 */
export async function pauseIdentityHabitCore(
  supabase: TypedClient,
  userId: string,
  habitId: string,
  now: Date,
  timezone: string
): Promise<void> {
  const { data: updated, error: updateError } = await supabase
    .from("identity_habits")
    .update({ status: "paused" })
    .eq("id", habitId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) return; // not active (already paused/archived/foreign id) -- true no-op, same convention as archive

  const today = localDateString(now, timezone);
  const { error: pauseError } = await supabase
    .from("identity_habit_pauses")
    .insert({ user_id: userId, habit_id: habitId, paused_at: today });
  if (pauseError) throw pauseError;
}

/**
 * P3-07 -- resumes a paused habit: closes its open pause-log row
 * (`resumed_at` = today, if one exists -- migration 202's own partial
 * unique index guarantees at most one) and flips status back to 'active'.
 * PAUSE-LOG ROW CLOSED FIRST, THEN STATUS -- the mirror-image ordering
 * from `pauseIdentityHabitCore`'s own reasoning: if the status flip then
 * fails, the habit stays visibly 'paused' (a safe, honest state) rather
 * than silently reading 'active' again with a pause window that never
 * got closed, which would keep excluding days from decay forever by
 * accident.
 */
export async function resumeIdentityHabitCore(
  supabase: TypedClient,
  userId: string,
  habitId: string,
  now: Date,
  timezone: string
): Promise<void> {
  const today = localDateString(now, timezone);
  const { error: closeError } = await supabase
    .from("identity_habit_pauses")
    .update({ resumed_at: today })
    .eq("user_id", userId)
    .eq("habit_id", habitId)
    .is("resumed_at", null);
  if (closeError) throw closeError;

  const { error: statusError } = await supabase
    .from("identity_habits")
    .update({ status: "active" })
    .eq("id", habitId)
    .eq("user_id", userId)
    .eq("status", "paused");
  if (statusError) throw statusError;
}

export type KillHabitResult = { ok: true } | { ok: false; reason: "requires_reason" };

/**
 * P2-11 -- the escalation-aware kill flow named in
 * archiveIdentityHabitCore's own header above. A NEW, parallel path, not a
 * replacement for archiveIdentityHabitCore (which stays exactly as-is for
 * any caller that doesn't need escalation).
 *
 * THE GATE IS RE-CHECKED SERVER-SIDE, NEVER TRUSTED FROM THE CLIENT: the
 * UI can decide "should I show the reason field" from an already-fetched
 * vote count for responsiveness, but this function does its OWN count
 * against `habit_votes` before deciding whether `reason` was required --
 * a stale or forged client-side read must never let an investment-heavy
 * habit slip through as an un-reasoned kill.
 *
 * `reason` is validated non-empty (after trim) when required -- an
 * all-whitespace "reason" would satisfy a naive `!reason` check while
 * being exactly as uninformative as no reason at all.
 */
export async function killIdentityHabitCore(supabase: TypedClient, userId: string, habitId: string, reason?: string): Promise<KillHabitResult> {
  const { count, error: countError } = await supabase
    .from("habit_votes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("habit_id", habitId);
  if (countError) throw countError;

  const trimmedReason = reason?.trim();
  if (killRequiresReason(count ?? 0) && !trimmedReason) {
    return { ok: false, reason: "requires_reason" };
  }

  const { error } = await supabase
    .from("identity_habits")
    .update({ status: "archived", archived_at: new Date().toISOString(), kill_reason: trimmedReason ?? null })
    .eq("id", habitId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return { ok: true };
}

/**
 * Rejects a cast/retraction dated anything other than the caller's own
 * local today, computed server-side from `now`/`timezone` -- NEVER trusted
 * from `requestedDate` itself. This is the whole enforcement of "votes may
 * only be cast or retracted for local today, no backfilling" (ruled
 * 2026-09-14): retroactive votes would turn an identity mechanic into a
 * checklist editable to make the number look good, exactly the
 * recording-not-deciding pattern this product rejects. Exported so the
 * "use server" wrapper (app/(app)/habits/actions.ts) and both vote
 * functions below share one definition of "today" rather than each
 * re-deriving it -- see the CLAUDE.md hard rule against deriving a calendar
 * date from a raw Date, which is exactly why `requestedDate` is compared
 * against this, never the other way around.
 */
function assertRequestedDateIsToday(requestedDate: string, now: Date, timezone: string): void {
  const today = localDateString(now, timezone);
  if (requestedDate !== today) {
    throw new Error("Votes can only be cast or retracted for today.");
  }
}

/**
 * #40 — casts (affirms) a vote for `habitId` on the caller's local today.
 * SET, NOT READ-THEN-BRANCH (same doctrine as app/(app)/worries/actions.ts's
 * header: "a checkbox that flips whatever the row currently holds races a
 * double-tap into the wrong state"): this asserts "voted today" outright via
 * `upsert(..., { ignoreDuplicates: true })` against
 * `habit_votes_user_habit_date_key` (migration 175's one-vote-per-day
 * unique constraint) rather than reading for an existing row and branching
 * on it, so two overlapping calls (a genuine double-tap) can never race
 * into two rows or a spurious 23505 -- the second call is a true no-op at
 * the database level, not merely one this code happens to tolerate.
 */
export async function castHabitVoteCore(
  supabase: TypedClient,
  userId: string,
  habitId: string,
  requestedDate: string,
  now: Date,
  timezone: string
): Promise<void> {
  assertRequestedDateIsToday(requestedDate, now, timezone);
  const today = localDateString(now, timezone);
  const { error } = await supabase
    .from("habit_votes")
    .upsert({ user_id: userId, habit_id: habitId, date: today }, { onConflict: "user_id,habit_id,date", ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * #40 — retracts today's vote for `habitId`, if one exists. A DELETE that
 * matches zero rows (nothing to retract, or already retracted by an
 * overlapping call) is not an error -- same SET-not-toggle reasoning as
 * `castHabitVoteCore` above.
 *
 * P4-34: the DELETE above is scoped by (user_id, habit_id, date) against
 * `habit_votes`, not `identity_habits` -- a DELETE never raises an FK
 * violation for a WHERE-clause miss the way `castHabitVoteCore`'s upsert
 * genuinely does, so the registry handler's FK-violation catch that used to
 * wrap this call was dead code: a bad/cross-tenant `habitId` silently
 * matched zero rows on the vote table and reported success. This existence
 * check is the split ENG-A's triage calls for: confirm the HABIT is real
 * first (scoped by user_id, same tenancy scope the delete itself uses),
 * THEN let the delete's own zero-or-more-rows result stay a true no-op
 * either way -- "already retracted" and "never voted today" both still
 * succeed silently; only "no such habit" now errors.
 */
export async function retractHabitVoteCore(
  supabase: TypedClient,
  userId: string,
  habitId: string,
  requestedDate: string,
  now: Date,
  timezone: string
): Promise<void> {
  assertRequestedDateIsToday(requestedDate, now, timezone);
  const { data: habit, error: habitError } = await supabase.from("identity_habits").select("id").eq("id", habitId).eq("user_id", userId).maybeSingle();
  if (habitError) throw habitError;
  if (!habit) throw new ToolNotFoundError(`No identity habit found with id "${habitId}".`);

  const today = localDateString(now, timezone);
  const { error } = await supabase.from("habit_votes").delete().eq("user_id", userId).eq("habit_id", habitId).eq("date", today);
  if (error) throw error;
}
