import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Business's completed-goals archive (#53) — reads `public.goals` (migration
 * 165, #43/#44) filtered to `domain = 'business'` and `status = 'done'`.
 *
 * NOT `weekly_goals` — that table has no completion lifecycle at all (no
 * `status`/`completed_at`), so there is nothing there to archive; the
 * spec's own text says so ("Business's current weekly_goals table has no
 * completion lifecycle — don't try to archive it"). `goals.domain` is a
 * plain nullable `text` with no CHECK constraint (see migration 165), so
 * `'business'` is an admitted value without a schema change.
 *
 * A goal only ever lands here if it was created through the Goals page
 * (`/goals`, #43/#44) with "Business" picked from that page's own domain
 * selector — see `components/goals/goal-board.tsx`'s `DOMAIN_OPTIONS`. That
 * selector is what gives this archive any rows to show; without it this
 * would be another built-and-uninvoked mechanism (CLAUDE.md's "no reader =
 * not done" bar, mirrored here as "no writer = no rows").
 */
export type CompletedBusinessGoal = {
  id: string;
  title: string;
  /** ISO date-only (`YYYY-MM-DD`) portion of `goals.completed_at`, ready for `formatShortDate`. */
  completedDateStr: string;
};

export async function getCompletedBusinessGoals(
  supabase: SupabaseClient,
  userId: string
): Promise<CompletedBusinessGoal[]> {
  const { data, error } = await supabase
    .from("goals")
    .select("id, title, completed_at")
    .eq("user_id", userId)
    .eq("domain", "business")
    .eq("status", "done")
    .order("completed_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r: { completed_at: string | null }) => r.completed_at !== null)
    .map((r: { id: string; title: string; completed_at: string }) => ({
      id: r.id,
      title: r.title,
      completedDateStr: r.completed_at.slice(0, 10),
    }));
}
