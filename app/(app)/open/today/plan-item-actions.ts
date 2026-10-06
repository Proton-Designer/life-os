"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { startWorkSessionCore, type StartSessionObjectiveInput } from "@/lib/business/actions-core";
import { setPlanLineCompletedCore, startTaskTimerCore, stopTaskTimerCore } from "@/lib/night-plan/plan-details-core";
import type { SessionObjective } from "@/lib/business/session-objectives";
import { startBehavior } from "@/lib/plan/plan-behavior";
import { getActiveWorkSessionDetail } from "@/lib/business/active-session";

/**
 * Home's plan list actions -- the cookie-authed layer over the cores. Each returns `{ ok: false, message }` for an
 * expected refusal (a session already running) rather than throwing, so the row can say so in place.
 */

/** The running session, in the Lock-In provider's own shape, so the client can show it with no second round trip. */
export type StartedSession = { id: string; startedAtIso: string; kind: "deep_work" | "deep_study"; goalMinutes: number | null; objectives: SessionObjective[] };

export type StartPlanItemResult =
  | { ok: true; kind: "session"; sessionKind: "deep_work" | "deep_study"; session: StartedSession }
  | { ok: true; kind: "timer"; startedAt: string }
  /** `activeSession`: the refusal was "a session is already running" -- here it is, so the client can open it. */
  | { ok: false; message: string; activeSession?: StartedSession };

function toStartedSession(detail: Awaited<ReturnType<typeof getActiveWorkSessionDetail>>): StartedSession | null {
  if (!detail || (detail.kind !== "deep_work" && detail.kind !== "deep_study")) return null;
  return { id: detail.id, startedAtIso: detail.startedAt, kind: detail.kind, goalMinutes: detail.goalMinutes, objectives: detail.objectives };
}

/**
 * Start pressed on a plan line. What starting MEANS comes from the one pure rule (lib/plan/plan-behavior.ts):
 * Business -> Deep Work, School -> Deep Study (timed when the line has a timer, otherwise elapsed), anything else
 * with timing -> an inline timer. The behaviour is re-derived HERE from the row, never taken from the client, so a
 * stale button cannot start the wrong thing.
 */
export async function startPlanItem(taskId: string): Promise<StartPlanItemResult> {
  const { supabase, userId } = await requireUser();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, plan_area, planned_start_time, planned_duration_minutes, class_id, kill_list_item_id, completed")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !task) return { ok: false, message: "Couldn't find that task." };
  if (task.completed) return { ok: false, message: "That task is already done." };

  const behavior = startBehavior(task.plan_area as string | null, { startTime: task.planned_start_time as string | null, durationMinutes: task.planned_duration_minutes as number | null });
  if (behavior.kind === "complete_only") return { ok: false, message: "Nothing to start: set a start time or a timer first." };

  try {
    if (behavior.kind === "inline_timer") {
      const { startedAt } = await startTaskTimerCore(supabase, userId, taskId, new Date());
      return { ok: true, kind: "timer", startedAt };
    }
    // A paired Kill List line is a Kill List objective (completing it from the session completes both rows); anything else is a task objective.
    const objective: StartSessionObjectiveInput = task.kill_list_item_id ? { kind: "kill_list_item", killListItemId: task.kill_list_item_id as string } : { kind: "task", taskId };
    await startWorkSessionCore(supabase, userId, {
      kind: behavior.kind,
      goalMinutes: behavior.goalMinutes,
      classId: behavior.kind === "deep_study" ? ((task.class_id as string | null) ?? null) : null,
      objectives: [objective],
    });
    // No revalidatePath here: it would make this action wait for Home to re-render before answering (the 2-3 s
    // lag). The client shows the session from the detail below and schedules its own refresh afterwards.
    const session = toStartedSession(await getActiveWorkSessionDetail(userId));
    if (!session) return { ok: false, message: "Started, but couldn't open the session. Refresh the page." };
    return { ok: true, kind: "session", sessionKind: behavior.kind, session };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("already active")) {
      const activeSession = toStartedSession(await getActiveWorkSessionDetail(userId)) ?? undefined;
      return { ok: false, message: "Another session is already running. Opening it.", activeSession };
    }
    return { ok: false, message: "Couldn't start that. Try again." };
  }
}

/** Sets a plan line's completion (and its paired Kill List row's). Hot tap: no revalidatePath -- the list schedules one deferred refresh per burst. */
export async function setPlanItemCompleted(taskId: string, completed: boolean): Promise<{ ok: boolean; message: string }> {
  const { supabase, userId } = await requireUser();
  try {
    await setPlanLineCompletedCore(supabase, userId, taskId, completed, new Date());
  } catch {
    return { ok: false, message: "Couldn't update that task. Try again." };
  }
  return { ok: true, message: "Saved." };
}

/** Stops an inline timer without completing the task. */
export async function stopPlanItemTimer(taskId: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, userId } = await requireUser();
  try {
    await stopTaskTimerCore(supabase, userId, taskId);
  } catch {
    return { ok: false, message: "Couldn't stop the timer. Try again." };
  }
  revalidatePath("/");
  return { ok: true, message: "Stopped." };
}
