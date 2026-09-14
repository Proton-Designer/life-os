/**
 * Goals — read side used by the Night Plan's seeding (#45).
 *
 * DEPENDS ON THE MIGRATION IN `supabase/migrations/` FOR `goals` AND
 * `goal_milestones` (architect's schema — see that migration's header for
 * the reasoning: new tables, not a reshape of `weekly_goals`). Written and
 * proved in `BEGIN; … ROLLBACK;` but NOT applied to production by this
 * track (R32-style discipline: numbers and applies belong to the lead).
 * Until it is applied, any call into this file will fail with "relation
 * does not exist" — that is expected, not defensive-coded around, the same
 * way every other track's schema-dependent code in this program ships
 * ahead of its own migration being applied.
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
  monthStart: string
): Promise<UnfinishedMilestone[]> {
  const { data, error } = await supabase
    .from("goal_milestones")
    .select("id, goal_id, title")
    .eq("user_id", userId)
    .eq("month_start", monthStart)
    .is("done_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: { id: string; goal_id: string; title: string }) => ({
    id: r.id,
    goalId: r.goal_id,
    title: r.title,
  }));
}

/** First of the month for an already-local `YYYY-MM-DD` date string. Pure string slicing — see this file's header on why no `Date` object is involved. */
export function monthStartFor(localDateStr: string): string {
  return `${localDateStr.slice(0, 7)}-01`;
}
