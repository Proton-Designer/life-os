"use server";

import { revalidateBusinessScreens } from "@/lib/work/revalidate-screens";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  createGoal,
  completeGoal,
  dropGoal,
  addMilestone,
  completeMilestone,
  reopenMilestone,
  type GoalStatus,
} from "@/lib/goals/actions-core";

/**
 * "use server" wrappers around `lib/goals/actions-core.ts` (#43/#44) — that
 * file is cookie-agnostic, shaped like `lib/tasks/actions-core.ts`, so a
 * page action and (later) an MCP write tool can share one implementation.
 * This file is the page's own caller: `requireUser()` for the session,
 * Postgres errors mapped to messages a person can act on rather than a raw
 * "duplicate key value violates unique constraint" string, and
 * `revalidatePath` on every surface a write can change.
 *
 * THE 5-GOAL CEILING IS SURFACED HONESTLY, NOT HIDDEN (per the build brief):
 * `createGoal` does not pre-check occupancy — `goals_rank_per_month_idx`
 * (migration 165) is the actual guard, so a rank collision (usually "all 5
 * ranks are taken") comes back as a real Postgres unique-violation (code
 * 23505), which `describeGoalError` turns into "That rank is already
 * spoken for this month." rather than a stack trace-looking string. The
 * page's own ceiling messaging (all 5 active) is a UI nicety on top of
 * this, not a replacement for it — a race between two tabs still gets a
 * correct, readable refusal from the database.
 */

type ActionResult<T = { ok: true }> = T | { error: string };

function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}

function isPgCheckViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23514";
}

function describeGoalError(err: unknown, context: "goal" | "milestone"): string {
  if (isPgUniqueViolation(err)) {
    return context === "goal"
      ? "That rank is already taken by another active goal this month. Your 5 active goals are full — complete or drop one first."
      : "This goal already has a milestone for this month.";
  }
  if (isPgCheckViolation(err)) {
    return context === "goal" ? "A goal needs a title and a reason." : "A milestone needs a title.";
  }
  const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
  return message;
}

function revalidateGoalSurfaces() {
  revalidatePath("/goals");
  revalidatePath("/week");
  // Business's completed-goals archive (#53) reads goals where
  // domain='business' — a goal created/completed/dropped here can change
  // what that archive shows.
  revalidateBusinessScreens();
}

export type CreateGoalActionInput = {
  monthStart: string;
  title: string;
  reason: string;
  rank: 1 | 2 | 3 | 4 | 5;
  domain?: string | null;
};

export async function createGoalAction(input: CreateGoalActionInput): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  const title = input.title.trim();
  const reason = input.reason.trim();
  if (!title) return { error: "Give this goal a title." };
  if (!reason) return { error: "Say why this goal matters — the reason is required." };

  try {
    await createGoal(supabase, userId, {
      monthStart: input.monthStart,
      title,
      reason,
      rank: input.rank,
      domain: input.domain ?? null,
    });
  } catch (err) {
    return { error: describeGoalError(err, "goal") };
  }
  revalidateGoalSurfaces();
  return { ok: true };
}

export async function setGoalStatusAction(goalId: string, status: Extract<GoalStatus, "done" | "dropped">): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    if (status === "done") {
      await completeGoal(supabase, userId, goalId);
    } else {
      await dropGoal(supabase, userId, goalId);
    }
  } catch (err) {
    return { error: describeGoalError(err, "goal") };
  }
  revalidateGoalSurfaces();
  return { ok: true };
}

export async function addMilestoneAction(input: { goalId: string; monthStart: string; title: string }): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  const title = input.title.trim();
  if (!title) return { error: "Give the milestone a title." };

  try {
    await addMilestone(supabase, userId, { goalId: input.goalId, monthStart: input.monthStart, title });
  } catch (err) {
    return { error: describeGoalError(err, "milestone") };
  }
  revalidatePath("/goals");
  revalidatePath("/week");
  return { ok: true };
}

export async function setMilestoneDoneAction(milestoneId: string, done: boolean): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    if (done) {
      await completeMilestone(supabase, userId, milestoneId);
    } else {
      await reopenMilestone(supabase, userId, milestoneId);
    }
  } catch (err) {
    return { error: describeGoalError(err, "milestone") };
  }
  // Hot tap: no revalidatePath here -- the milestone control schedules ONE
  // refreshGoalViews() per burst (PERF-4).
  return { ok: true };
}

/** Data-free cache revalidation scheduled by the milestone checkbox after a burst of taps (PERF-4). */
export async function refreshGoalViews(): Promise<void> {
  await requireUser();
  revalidatePath("/goals");
  revalidatePath("/week");
}
