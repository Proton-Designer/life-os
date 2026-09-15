import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

/**
 * Phase 2 #P2-06 — timeboxing, on Merged Today (app/(app)/open/today/page.tsx).
 *
 * SCOPE: Night Plan's own already-established "today's plan" set — rows
 * with `planned_date = today` and `mit_rank IS NOT NULL` (the starred/
 * crowned items). Same query shape as `getEveningCloseData`'s own
 * `todaysThree` (app/(app)/close/actions.ts), whose own comment states the
 * exact rule this reuses verbatim: "a null mit_rank means 'dumped, not
 * starred', which is a real state and deliberately not part of today's
 * three." Timeboxing extends THAT set with an optional start time; it does
 * not invent a separate, broader "what's on today" pool.
 *
 * TIMELINE ORDER: by `planned_start_time` ascending, nulls LAST (an
 * unscheduled item has no place on a timeline, so it sorts after every
 * scheduled one rather than arbitrarily first) with `mit_rank` as the
 * tiebreak — matches the order the item already has meaning in (the crown
 * is rank 1) when two items share a start time or neither has one.
 *
 * NO DURATION/ESTIMATE FIELD ANYWHERE IN THIS FILE — see migration 192's
 * own header for why that absence is deliberate, not a gap.
 */

export interface TimeboxedTask {
  id: string;
  title: string;
  mitRank: number;
  /** "HH:MM" 24h local clock time, or null when unscheduled. */
  plannedStartTime: string | null;
  /** A completed item stays ON the timeline (crossed out, not hidden) — matching `todaysThree`'s own shape (app/(app)/close/actions.ts), which likewise never filters on `completed`. Vanishing a scheduled block from its own timeline the moment it's done would make the timeline a worse record of the day, not a better one. */
  completed: boolean;
}

export async function getTodaysTimeboxedTasks(supabase: TypedClient, userId: string, plannedDate: string): Promise<TimeboxedTask[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, mit_rank, planned_start_time, completed")
    .eq("user_id", userId)
    .eq("planned_date", plannedDate)
    .not("mit_rank", "is", null);
  if (error) throw error;

  const rows = (data ?? []) as { id: string; title: string; mit_rank: number | null; planned_start_time: string | null; completed: boolean }[];

  return rows
    .map((r) => ({ id: r.id, title: r.title, mitRank: r.mit_rank as number, plannedStartTime: r.planned_start_time, completed: r.completed }))
    .sort((a, b) => {
      if (a.plannedStartTime !== null && b.plannedStartTime !== null) {
        if (a.plannedStartTime !== b.plannedStartTime) return a.plannedStartTime < b.plannedStartTime ? -1 : 1;
        return a.mitRank - b.mitRank;
      }
      if (a.plannedStartTime !== null) return -1; // scheduled sorts before unscheduled
      if (b.plannedStartTime !== null) return 1;
      return a.mitRank - b.mitRank; // both unscheduled -- fall back to crown order
    });
}
