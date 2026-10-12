"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { startWorkSessionCore, type StartSessionObjectiveInput } from "@/lib/business/actions-core";
import { setPlanLineCompletedCore, startTaskTimerCore } from "@/lib/night-plan/plan-details-core";
import { activeSessionForTaskCore, endSessionAndBankCore, markSessionPausedCore, pauseTaskTimerCore, resumePausedSessionCore, settleTaskWorkCore } from "@/lib/night-plan/plan-work-core";
import { revalidateBusinessScreens } from "@/lib/work/revalidate-screens";
import type { SessionObjective } from "@/lib/business/session-objectives";
import { remainingGoalMinutes, startBehavior } from "@/lib/plan/plan-behavior";
import { getActiveWorkSessionDetail } from "@/lib/business/active-session";

/**
 * Home's plan list actions -- the cookie-authed layer over the cores. Each returns `{ ok: false, message }` for an
 * expected refusal (a session already running) rather than throwing, so the row can say so in place.
 */

/** The running session, in the Lock-In provider's own shape, so the client can show it with no second round trip. */
export type StartedSession = {
  id: string;
  startedAtIso: string;
  kind: "deep_work" | "deep_study";
  goalMinutes: number | null;
  objectives: SessionObjective[];
  /** The plan line this session works on (the overlay then offers Pause + Mark Done) and the seconds already banked on it. */
  planTaskId: string | null;
  bankedSeconds: number;
};

export type StartPlanItemResult =
  | { ok: true; kind: "session"; sessionKind: "deep_work" | "deep_study"; session: StartedSession }
  | { ok: true; kind: "timer"; startedAt: string }
  /** `activeSession`: the refusal was "a session is already running" -- here it is, so the client can open it. */
  | { ok: false; message: string; activeSession?: StartedSession };

function toStartedSession(detail: Awaited<ReturnType<typeof getActiveWorkSessionDetail>>): StartedSession | null {
  if (!detail || (detail.kind !== "deep_work" && detail.kind !== "deep_study")) return null;
  return { id: detail.id, startedAtIso: detail.startedAt, kind: detail.kind, goalMinutes: detail.goalMinutes, objectives: detail.objectives, planTaskId: detail.planTaskId, bankedSeconds: detail.bankedSeconds };
}

/**
 * Start (and Resume) pressed on a plan line. What starting MEANS comes from the one pure rule (lib/plan/plan-behavior.ts):
 * Business -> Deep Work, School -> Deep Study (timed when the line has a timer, otherwise elapsed), anything else
 * with timing -> an inline timer. The behaviour is re-derived HERE from the row, never taken from the client, so a
 * stale button cannot start the wrong thing.
 */
export async function startPlanItem(taskId: string): Promise<StartPlanItemResult> {
  const { supabase, userId } = await requireUser();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, plan_area, planned_start_time, planned_duration_minutes, class_id, kill_list_item_id, completed, timer_elapsed_seconds")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !task) return { ok: false, message: "Couldn't find that task." };
  if (task.completed) return { ok: false, message: "That task is already done." };

  const behavior = startBehavior(task.plan_area as string | null, { startTime: task.planned_start_time as string | null, durationMinutes: task.planned_duration_minutes as number | null });
  if (behavior.kind === "complete_only") return { ok: false, message: "Nothing to start: set a start time or a timer first." };
  // RESUME is the same call: an inline timer keeps what is banked (startTaskTimerCore only stamps the start), and a session
  // continues with a goal of what is LEFT of the line's timer (open-ended when the line has no timer, or none is left).
  const bankedSeconds = (task.timer_elapsed_seconds as number | null) ?? 0;
  const goalMinutes = bankedSeconds > 0 ? remainingGoalMinutes(task.planned_duration_minutes as number | null, bankedSeconds) : behavior.goalMinutes;

  try {
    if (behavior.kind === "inline_timer") {
      const { startedAt } = await startTaskTimerCore(supabase, userId, taskId, new Date());
      return { ok: true, kind: "timer", startedAt };
    }
    // A paired Kill List line is a Kill List objective (completing it from the session completes both rows); anything else is a task objective.
    const objective: StartSessionObjectiveInput = task.kill_list_item_id ? { kind: "kill_list_item", killListItemId: task.kill_list_item_id as string } : { kind: "task", taskId };
    // Resume of a paused session re-opens the SAME row (the timer continues, no new block); only a line with no paused session starts a new one.
    const resumed = bankedSeconds > 0 ? await resumePausedSessionCore(supabase, userId, { id: taskId, kill_list_item_id: (task.kill_list_item_id as string | null) ?? null }, new Date()) : null;
    if (!resumed) {
      await startWorkSessionCore(supabase, userId, {
        kind: behavior.kind,
        goalMinutes,
        classId: behavior.kind === "deep_study" ? ((task.class_id as string | null) ?? null) : null,
        objectives: [objective],
      });
    }
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

/**
 * Sets a plan line's completion (and its paired Kill List row's). Completing from ANY state first settles the work: a
 * running inline stretch is banked and a running session working on the line is ended through the same path End Session
 * uses (time banked once), then the line is completed. Hot tap: no revalidatePath unless a session ended -- the list
 * schedules one deferred refresh per burst.
 */
export async function setPlanItemCompleted(taskId: string, completed: boolean): Promise<{ ok: boolean; message: string }> {
  const { supabase, userId } = await requireUser();
  try {
    let sessionEnded = false;
    if (completed) sessionEnded = (await settleTaskWorkCore(supabase, userId, taskId, new Date())).sessionEnded;
    await setPlanLineCompletedCore(supabase, userId, taskId, completed, new Date());
    if (sessionEnded) {
      revalidateBusinessScreens();
      revalidatePath("/");
    }
  } catch {
    return { ok: false, message: "Couldn't update that task. Try again." };
  }
  return { ok: true, message: "Saved." };
}

export type PausePlanItemResult = { ok: true; kind: "timer" | "session" | "none"; elapsedSeconds: number } | { ok: false; message: string };

/**
 * Pause pressed on a plan line (it REPLACES the old Stop, which reset the timer). An inline timer banks its running stretch
 * in one guarded update; a Deep Session is ended through the SAME core End Session uses and its server-recorded duration
 * is banked, only if this call is the one that ended it. Idempotent: a second call banks nothing. Nothing running is an ok no-op.
 */
export async function pausePlanItem(taskId: string): Promise<PausePlanItemResult> {
  const { supabase, userId } = await requireUser();
  try {
    const { data: task, error } = await supabase.from("tasks").select("id, kill_list_item_id, timer_elapsed_seconds").eq("id", taskId).eq("user_id", userId).maybeSingle();
    if (error || !task) return { ok: false, message: "Couldn't find that task." };
    const sessionId = await activeSessionForTaskCore(supabase, userId, { id: task.id as string, kill_list_item_id: (task.kill_list_item_id as string | null) ?? null });
    if (sessionId) {
      const res = await endSessionAndBankCore(supabase, userId, sessionId, undefined, taskId);
      if (res.ended) await markSessionPausedCore(supabase, userId, sessionId);
      // Same refresh End Session does: Home and the Business screens show the ended session.
      revalidateBusinessScreens();
      revalidatePath("/");
      // `elapsedSeconds` is null only when this call did not end the session (a retry): then what is banked is whatever the first call stored.
      const banked = res.elapsedSeconds ?? ((task.timer_elapsed_seconds as number | null) ?? 0);
      return { ok: true, kind: "session", elapsedSeconds: banked };
    }
    const res = await pauseTaskTimerCore(supabase, userId, taskId, new Date());
    return { ok: true, kind: res.paused ? "timer" : "none", elapsedSeconds: res.elapsedSeconds };
  } catch {
    return { ok: false, message: "Couldn't pause that. Try again." };
  }
}
