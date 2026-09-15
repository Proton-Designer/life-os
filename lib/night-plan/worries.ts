/**
 * Worries — read side, shared by two surfaces: the standalone Worry List
 * (item #42, `app/(app)/worries`) and the Night Plan's seeding (item #28,
 * `app/(app)/close/actions.ts`).
 *
 * THE BUG THIS FILE EXISTS TO FIX: a worry is a `tasks` row written by
 * `captureDump({source:"worry"})` (`lib/capture/actions.ts`) with
 * `dump_source='worry'`, `domain=null`, `planned_date=today` (the day it was
 * captured, not a plan date). Every existing reader of dumped rows filters
 * by `planned_date` — the close's `tomorrowRows` wants `planned_date =
 * tomorrow`, the ranked-plan queries want a specific day and `mit_rank not
 * null`. A worry dumped today matches none of them: it is written and then
 * permanently invisible. Zero rows existed in production after 12 days of
 * this write path being live.
 *
 * THE FIX IS THE QUERY SHAPE: find a worry BY KIND (`dump_source='worry'`),
 * never by `planned_date`. A worry is "open" for as long as it exists and
 * hasn't been marked handled — which day it happened to be typed on is not
 * the question a worry list answers.
 *
 * HANDLED REUSES `tasks.completed` / `tasks.completed_at` RATHER THAN A NEW
 * COLUMN OR TABLE. Justification (BOSS-VISION §5's "no new table" ruling for
 * this exact write path, and the same discipline migrations 119/120 already
 * applied to this table): a worry has exactly one meaningful lifecycle
 * transition — open to resolved — and `completed`/`completed_at` already
 * mean precisely that for every other task in this table
 * (`lib/tasks/actions-core.ts`'s `toggleTaskCore`). Inventing a second
 * "handled" concept next to "completed" would make the same table answer
 * the same question two different ways, which is the exact anti-pattern
 * migration 119's header warns against for `domain`. A worry's `completed`
 * has no `due_date`/`mit_rank` semantics riding on it the way a school
 * task's does, so there is no collision to worry about.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DumpItem } from "./night-plan";

/** P2-12: how a worry was resolved, recorded only by the Monday Anti-Worry Hour panel — see migration 201's own header for why this is a separate question from `completed`. */
export type WorryOutcome = "resolved" | "took_action" | "let_go";

export type Worry = {
  id: string;
  title: string;
  createdAt: string;
  completed: boolean;
  completedAt: string | null;
  outcome: WorryOutcome | null;
};

const WORRY_COLUMNS = "id, title, created_at, completed, completed_at, worry_outcome";

function toWorry(row: {
  id: string;
  title: string;
  created_at: string;
  completed: boolean;
  completed_at: string | null;
  worry_outcome: string | null;
}): Worry {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    completed: row.completed,
    completedAt: row.completed_at,
    outcome: (row.worry_outcome as WorryOutcome | null) ?? null,
  };
}

/**
 * Every open (not-yet-handled) worry for this user, oldest first — the ones
 * that have been sitting the longest are the ones most worth surfacing.
 * NO `planned_date` filter, deliberately: see this file's header.
 */
export async function getOpenWorries(supabase: SupabaseClient, userId: string): Promise<Worry[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(WORRY_COLUMNS)
    .eq("user_id", userId)
    .eq("dump_source", "worry")
    .eq("completed", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toWorry);
}

/** Handled worries, most-recently-handled first — for the Worry List's own "Handled" section. */
export async function getHandledWorries(supabase: SupabaseClient, userId: string, limit = 50): Promise<Worry[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(WORRY_COLUMNS)
    .eq("user_id", userId)
    .eq("dump_source", "worry")
    .eq("completed", true)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toWorry);
}

/** Adapts open worries into the Night Plan engine's seed shape (`lib/night-plan/night-plan.ts`). */
export function worriesToDumpItems(worries: readonly Worry[]): DumpItem[] {
  return worries.map((w) => ({ id: w.id, title: w.title, source: "worry" as const }));
}
