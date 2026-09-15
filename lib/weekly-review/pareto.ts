import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export type ParetoBar = { label: string; count: number };

/** Ruled 2026-09-14: a distraction event whose trigger can't be resolved is shown, never silently dropped. */
export const UNCATEGORIZED_LABEL = "Uncategorized";

/**
 * #47 — every distraction event since day one, counted by cause,
 * descending, all-time.
 *
 * Deliberately does NOT reuse getTriggersForDomain/getAllTriggers
 * (lib/distractions/queries.ts): both filter `archived = false`, which
 * would silently erase a Pareto bar's entire history the moment its
 * trigger is archived — exactly the kind of "check that examines nothing"
 * gap this migration/ruling called out. This queries `distraction_triggers`
 * directly, unfiltered by `archived`.
 *
 * Aggregated in JS after two scoped selects rather than a PostgREST
 * group-by, same style as lib/distractions/queries.ts's own
 * assembleSummaries — personal per-user row counts here are small.
 *
 * A distraction event whose `trigger_id` doesn't resolve to a fetched
 * trigger row folds into an explicit "Uncategorized" bar rather than being
 * dropped (per the ruling). In practice this is defensive rather than
 * reachable today: `distraction_events.trigger_id` is NOT NULL and its
 * composite FK to `distraction_triggers` is `ON DELETE CASCADE` (migration
 * 058), so deleting a trigger takes its events with it — there is no
 * schema-legal way today for an event to outlive its trigger. The bar
 * exists anyway so a future relaxation of that FK (e.g. a `SET NULL` for a
 * "delete trigger, keep history" feature) doesn't silently start dropping
 * events from this chart instead of surfacing them.
 */
export async function getDistractionPareto(supabase: TypedClient, userId: string): Promise<ParetoBar[]> {
  const [{ data: events, error: eventsError }, { data: triggers, error: triggersError }] = await Promise.all([
    supabase.from("distraction_events").select("trigger_id").eq("user_id", userId),
    supabase.from("distraction_triggers").select("id, name").eq("user_id", userId),
  ]);
  if (eventsError) throw eventsError;
  if (triggersError) throw triggersError;

  const nameById = new Map((triggers ?? []).map((t) => [t.id as string, t.name as string]));
  const countByLabel = new Map<string, number>();
  for (const event of events ?? []) {
    const label = nameById.get(event.trigger_id as string) ?? UNCATEGORIZED_LABEL;
    countByLabel.set(label, (countByLabel.get(label) ?? 0) + 1);
  }

  return [...countByLabel.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
