import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addTaskCore } from "@/lib/tasks/actions-core";
import { dumpLineCore } from "@/lib/night-plan/plan-actions-core";
import { applyPlanDetailsCore } from "@/lib/night-plan/plan-details-core";
import type { PlanLineInput } from "@/lib/night-plan/plan-details";
import type { PlanArea } from "@/lib/plan/plan-behavior";

/**
 * A Task from the "+" sheet that belongs to a real area. It is a line on the plan day's plan (so it shows in Edit Plan
 * and Home's Today list) AND it lands where that area keeps its tasks, through the SAME core Edit Plan saves with:
 *   School    -> a School task for the plan day (the School page's task list)
 *   Work      -> the current Work target's Backlog (the weekly agenda pipeline)
 *   Business  -> that day's Kill List
 * A Task with a date other than the plan day stays what it was before: dated School/Work tasks keep their own date and
 * are not on today's plan; a dated Business task has no home that can hold a date, so the caller files it in the Inbox.
 * Shaped like every core here, `(supabase, userId, ...)`, so the Server Action and tests share it.
 */

export type PlannedCaptureArea = "school" | "co_op" | "business";

const PLAN_AREA_FOR: Record<PlannedCaptureArea, PlanArea> = { school: "school", co_op: "work", business: "business" };

export type CaptureTaskResult =
  | { kind: "planned"; id: string; notices: string[]; killListOverflow: string[] }
  | { kind: "dated" } // a School/Work task for another day: written as a plain dated task, not on today's plan
  | { kind: "inbox-dated" }; // a dated Business task: the caller files it in the Inbox so the date is kept

export async function captureAreaTaskCore(
  supabase: SupabaseClient,
  userId: string,
  planDay: string,
  input: { title: string; area: PlannedCaptureArea; dueDate?: string | null; dueTime?: string | null },
  opts: { killListAvailable: boolean },
): Promise<CaptureTaskResult> {
  const forPlanDay = !input.dueDate || input.dueDate === planDay;
  if (!forPlanDay) {
    if (input.area === "business") return { kind: "inbox-dated" };
    await addTaskCore(supabase, userId, {
      domain: input.area,
      title: input.title,
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.dueTime ? { dueTime: input.dueTime } : {}),
    });
    return { kind: "dated" };
  }

  const dumped = await dumpLineCore(supabase, userId, planDay, input.title);
  if ("error" in dumped) throw new Error(dumped.error);
  const line: PlanLineInput = {
    id: dumped.id,
    area: PLAN_AREA_FOR[input.area],
    addToKillList: input.area === "business",
    startTime: input.dueTime ?? null,
    durationMinutes: null,
    order: 999, // after the lines the person already ordered; Edit Plan renumbers on its next save
    criteria: null,
  };
  const applied = await applyPlanDetailsCore(supabase, userId, planDay, [line], { killListAvailable: opts.killListAvailable });
  if ("error" in applied) {
    // Never leave a half-made line (on the plan but not in its area): take it back out, then say what failed.
    await supabase.from("tasks").delete().eq("id", dumped.id).eq("user_id", userId);
    throw new Error(applied.error);
  }
  return { kind: "planned", id: dumped.id, notices: applied.notices, killListOverflow: applied.killListOverflow };
}
