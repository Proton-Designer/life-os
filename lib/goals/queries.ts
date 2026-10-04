/**
 * Goals — read side used by the Night Plan's seeding (#45).
 *
 * DEPENDS ON `goals` AND `goal_milestones` FROM MIGRATION 165
 * (`supabase/migrations/165_goals_and_milestones.sql` — architect's schema,
 * see that migration's header for the reasoning: new tables, not a reshape
 * of `weekly_goals`). 165 IS APPLIED to production — this file's queries
 * are live, not aspirational (stale note fixed 2026-09-14, #45 follow-up).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type UnfinishedMilestone = {
  id: string;
  goalId: string;
  title: string;
};

/**
 * Unfinished milestones for the given calendar month — `month_start` is
 * DENORMALISED onto `goal_milestones` for exactly this query (see the
 * migration header): a single-table `where user_id = ? and month_start = ?
 * and done_at is null`, no join to `goals`.
 *
 * `monthStart` must be the first of a month (`YYYY-MM-01`) — callers derive
 * it from `localDateString(now, tz)` (never a raw `Date`), sliced to
 * `YYYY-MM` plus `-01`; pure string arithmetic on an already-local date
 * string, the same shape as `lib/date-utils.ts`'s other calendar helpers.
 */
export async function getUnfinishedMilestonesForMonth(
  supabase: SupabaseClient,
  userId: string,
  monthStart: string,
  /** Goal ids to leave out (Deen Mode OFF passes the ids of "deen"-tagged goals). */
  excludeGoalIds: ReadonlySet<string> = new Set()
): Promise<UnfinishedMilestone[]> {
  const { data, error } = await supabase
    .from("goal_milestones")
    .select("id, goal_id, title")
    .eq("user_id", userId)
    .eq("month_start", monthStart)
    .is("done_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((r: { goal_id: string }) => !excludeGoalIds.has(r.goal_id))
    .map((r: { id: string; goal_id: string; title: string }) => ({
      id: r.id,
      goalId: r.goal_id,
      title: r.title,
    }));
}

/** Ids of this month's "deen"-tagged goals -- only queried when Deen Mode is OFF. */
export async function getDeenGoalIdsForMonth(supabase: SupabaseClient, userId: string, monthStart: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("goals").select("id").eq("user_id", userId).eq("month_start", monthStart).eq("domain", "deen");
  if (error) throw error;
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

/** First of the month for an already-local `YYYY-MM-DD` date string. Pure string slicing — see this file's header on why no `Date` object is involved. */
export function monthStartFor(localDateStr: string): string {
  return `${localDateStr.slice(0, 7)}-01`;
}

export type GoalMilestone = {
  id: string;
  goalId: string;
  title: string;
  doneAt: string | null;
};

/**
 * ALL milestones (done and unfinished both) for a calendar month — the
 * Goals page's own read, distinct from `getUnfinishedMilestonesForMonth`
 * above (which exists only to feed #45's Night Plan seeding and would hide
 * a completed milestone the page still needs to render with its checkmark).
 * At most one row per goal per month, per `goal_milestones_user_goal_month_key`
 * (migration 165) — callers may safely index the result by `goalId`.
 */
export async function getMilestonesForMonth(
  supabase: SupabaseClient,
  userId: string,
  monthStart: string
): Promise<GoalMilestone[]> {
  const { data, error } = await supabase
    .from("goal_milestones")
    .select("id, goal_id, title, done_at")
    .eq("user_id", userId)
    .eq("month_start", monthStart)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: { id: string; goal_id: string; title: string; done_at: string | null }) => ({
    id: r.id,
    goalId: r.goal_id,
    title: r.title,
    doneAt: r.done_at,
  }));
}
