/**
 * Goals (#43) and their milestones (#44) — core, `core(supabase, userId, ...)`
 * shaped like `lib/tasks/actions-core.ts`, so a cookie-authed page action and
 * (later) an MCP write tool can share one implementation.
 *
 * SCHEMA IS THE ARCHITECT'S, EXACTLY (see the migration for the full
 * reasoning): `goals` — a ranked portfolio, rank 1-5, scarce because
 * `goals_rank_per_month_idx` (a partial unique index scoped to
 * `status = 'active'`) refuses a sixth active rank per month, not because
 * this file counts to five. `goal_milestones` — `month_start` denormalised
 * on purpose (see the migration header) so #45's seeding query never joins
 * `goals`.
 *
 * THE CEILING IS ENFORCED BY THE DATABASE, NOT HERE. `createGoal` does not
 * pre-check "are there already 5 active goals this month" — the unique
 * index is the actual guard (same posture as `mit_rank`'s crown scarcity),
 * and duplicating the check here would just be a second place for the rule
 * to drift from the one that actually holds. A rank collision surfaces as a
 * plain Postgres error, passed through rather than swallowed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type GoalStatus = "active" | "done" | "dropped";

export type Goal = {
  id: string;
  monthStart: string;
  domain: string | null;
  title: string;
  reason: string;
  rank: number;
  status: GoalStatus;
  completedAt: string | null;
};

type GoalRow = {
  id: string;
  month_start: string;
  domain: string | null;
  title: string;
  reason: string;
  rank: number;
  status: GoalStatus;
  completed_at: string | null;
};

function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    monthStart: row.month_start,
    domain: row.domain,
    title: row.title,
    reason: row.reason,
    rank: row.rank,
    status: row.status,
    completedAt: row.completed_at,
  };
}

const GOAL_COLUMNS = "id, month_start, domain, title, reason, rank, status, completed_at";

export type CreateGoalInput = {
  monthStart: string;
  title: string;
  /** Non-blank — the DB's own CHECK enforces this too; #43's "with reason". */
  reason: string;
  rank: 1 | 2 | 3 | 4 | 5;
  domain?: string | null;
};

export async function createGoal(supabase: SupabaseClient, userId: string, input: CreateGoalInput): Promise<Goal> {
  const { data, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      month_start: input.monthStart,
      title: input.title,
      reason: input.reason,
      rank: input.rank,
      domain: input.domain ?? null,
    })
    .select(GOAL_COLUMNS)
    .single();
  if (error) throw error;
  return toGoal(data as GoalRow);
}

/** Every goal for a month, ranked — active and resolved (done/dropped) both, so a screen can show history rather than only the live five. */
export async function listGoalsForMonth(supabase: SupabaseClient, userId: string, monthStart: string): Promise<Goal[]> {
  const { data, error } = await supabase
    .from("goals")
    .select(GOAL_COLUMNS)
    .eq("user_id", userId)
    .eq("month_start", monthStart)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: GoalRow) => toGoal(r));
}

/**
 * Marks a goal done. Sets `completed_at` in the SAME write as `status` —
 * the DB's own `((status='done') = (completed_at is not null))` check would
 * reject one without the other anyway; this just means the app never sends
 * the half-shape in the first place.
 *
 * SCOPED TO `status = 'active'` DELIBERATELY: completing an already-done or
 * -dropped goal is a no-op (0 rows affected, not an error) rather than a
 * second, meaningless `completed_at` bump.
 */
export async function completeGoal(supabase: SupabaseClient, userId: string, goalId: string): Promise<void> {
  const { error } = await supabase
    .from("goals")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
}

/**
 * Drops a goal without claiming it was achieved. `completed_at` stays null
 * — the completion-pair CHECK requires exactly that for a non-'done' status
 * — and dropping RELEASES the rank: `goals_rank_per_month_idx` is scoped to
 * `status = 'active'`, so a sixth goal can now claim the vacated slot.
 */
export async function dropGoal(supabase: SupabaseClient, userId: string, goalId: string): Promise<void> {
  const { error } = await supabase
    .from("goals")
    .update({ status: "dropped" })
    .eq("id", goalId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
}

export type Milestone = { id: string; goalId: string; monthStart: string; title: string; doneAt: string | null };

type MilestoneRow = { id: string; goal_id: string; month_start: string; title: string; done_at: string | null };

function toMilestone(row: MilestoneRow): Milestone {
  return { id: row.id, goalId: row.goal_id, monthStart: row.month_start, title: row.title, doneAt: row.done_at };
}

const MILESTONE_COLUMNS = "id, goal_id, month_start, title, done_at";

/**
 * `monthStart` is passed explicitly rather than looked up from the parent
 * goal — the migration denormalises it onto this table on purpose (#45's
 * seeding query reads this table alone), and re-deriving it here from a
 * second read would just be the same fact stored twice with an extra step.
 * Callers pass the goal's own `monthStart`.
 */
export async function addMilestone(
  supabase: SupabaseClient,
  userId: string,
  input: { goalId: string; monthStart: string; title: string }
): Promise<Milestone> {
  const { data, error } = await supabase
    .from("goal_milestones")
    .insert({ user_id: userId, goal_id: input.goalId, month_start: input.monthStart, title: input.title })
    .select(MILESTONE_COLUMNS)
    .single();
  if (error) throw error;
  return toMilestone(data as MilestoneRow);
}

export async function completeMilestone(supabase: SupabaseClient, userId: string, milestoneId: string): Promise<void> {
  const { error } = await supabase
    .from("goal_milestones")
    .update({ done_at: new Date().toISOString() })
    .eq("id", milestoneId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function reopenMilestone(supabase: SupabaseClient, userId: string, milestoneId: string): Promise<void> {
  const { error } = await supabase
    .from("goal_milestones")
    .update({ done_at: null })
    .eq("id", milestoneId)
    .eq("user_id", userId);
  if (error) throw error;
}
