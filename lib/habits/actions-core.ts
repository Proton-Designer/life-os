import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";

type TypedClient = SupabaseClient<Database>;

/** Mirrors identity_habits_rank_per_user_idx (migration 175) -- restated here only so a caller reads the ceiling without opening the migration. */
export const MAX_ACTIVE_HABITS = 7;

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
 * THE CEILING IS `identity_habits_rank_per_user_idx` (migration 175), NOT
 * this function's pre-check -- same discipline as createGoal/165. The
 * pre-check below exists only to produce an honest "all 7 are full" error
 * instead of a raw 23505 in the common case; a genuine race between two
 * tabs still gets correctly refused by the database's partial unique index,
 * surfaced here as a normal Postgres error the caller can inspect (`code
 * === "23505"`).
 */
export async function createIdentityHabitCore(supabase: TypedClient, userId: string, identityStatement: string): Promise<Habit> {
  const trimmed = identityStatement.trim();
  if (!trimmed) {
    throw new Error("An identity habit needs a statement.");
  }

  const { data: active, error: selectError } = await supabase
    .from("identity_habits")
    .select("rank")
    .eq("user_id", userId)
    .eq("status", "active");
  if (selectError) throw selectError;

  const usedRanks = new Set((active ?? []).map((r) => r.rank as number));
  let nextRank: number | null = null;
  for (let r = 1; r <= MAX_ACTIVE_HABITS; r++) {
    if (!usedRanks.has(r)) {
      nextRank = r;
      break;
    }
  }
  if (nextRank === null) {
    throw new Error(`You already have ${MAX_ACTIVE_HABITS} active habits — archive one before adding another.`);
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
  const today = localDateString(now, timezone);
  const { error } = await supabase.from("habit_votes").delete().eq("user_id", userId).eq("habit_id", habitId).eq("date", today);
  if (error) throw error;
}
