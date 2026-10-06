/**
 * R5 core(supabase, userId, ...) extraction — done for real (team-lead,
 * school fan-out brief): "this is where lib/tasks/actions-core.ts genuinely
 * is in the path... strip requireUser(), take supabase/userId as
 * parameters, update the three callers." Same discipline as
 * lib/deen/actions-core.ts, lib/coop/targets-core.ts, lib/coop/tasks-core.ts
 * — NONE of the functions below call requireUser()/getProfile()/
 * getAuthedUser(). The 3 cookie-authed callers (app/(app)/work/actions.ts
 * [schedule-event functions only], app/(app)/school/actions.ts,
 * lib/capture/actions.ts) now each do their own requireUser() and pass
 * supabase/userId through explicitly.
 *
 * DELETE FUNCTIONS STAY IN THIS FILE, SHAPED LIKE EVERY OTHER FUNCTION HERE
 * (per the lead's literal instruction to fix "every exported function" in
 * this file), BUT ARE NOT WIRED INTO lib/mcp/write-registry.ts —
 * removeTaskCore and removeScheduleEventCore are real DELETEs, and the MCP
 * write path may never hard-delete a row (the standing guardrail, same
 * posture as removeTarget/unmarkPrayer/removeTask's own deletes staying
 * cookie-only elsewhere in this program). They are core-shaped because the
 * cookie-authed callers need that shape too, not because MCP can reach them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTaskType, type TaskType } from "./task-type";
import { isAssessmentType, normalizeAssessmentType } from "@/lib/school/assessment-types";
import { syncKillListFromTask } from "@/lib/plan/pair-sync";

export type TaskDomain = "school" | "co_op";
export type { TaskType };

export type AddTaskInput = {
  domain: TaskDomain;
  title: string;
  dueDate?: string;
  dueTime?: string;
  taskType?: TaskType;
  /** Set only when taskType is "other" — a task carries this iff its type is "other" (migration 050 enforces the pairing at the DB level too). */
  taskTypeOtherLabel?: string;
  /** References the `classes` table (migration 050+, once C's 048 lands) — never a specific schedule_events row. Omit/null for "Generic." */
  classId?: string | null;
};

/** Selects the real row id back off the insert — the MCP write contract ({id, updated_at}) needs a real id, never a synthesized one; the 3 cookie-authed callers simply discard the return value (`Promise<void>` wrappers), so this is additive, not a behavior change for them. */
export async function addTaskCore(supabase: SupabaseClient, userId: string, input: AddTaskInput): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      domain: input.domain,
      title: input.title,
      due_date: input.dueDate ?? null,
      due_time: input.dueTime ?? null,
      task_type: input.taskType ?? null,
      task_type_other_label: input.taskType === "other" ? (input.taskTypeOtherLabel ?? null) : null,
      class_id: input.classId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export type UpdateTaskInput = {
  title: string;
  dueDate?: string;
  taskType?: TaskType;
  taskTypeOtherLabel?: string;
  classId?: string | null;
};

/** Item 5's Edit popup: "change the contents of any task." Full-replace update, scoped by id + user_id like every other task mutation here. */
export async function updateTaskCore(supabase: SupabaseClient, userId: string, id: string, input: UpdateTaskInput): Promise<void> {
  // SCHOOL-01: a legacy 'final_midterm' is an Exam.
  const taskType = input.taskType ? normalizeTaskType(input.taskType) : undefined;
  const { error } = await supabase
    .from("tasks")
    .update({
      title: input.title,
      due_date: input.dueDate ?? null,
      task_type: taskType ?? null,
      task_type_other_label: taskType === "other" ? (input.taskTypeOtherLabel ?? null) : null,
      class_id: input.classId ?? null,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;

  // SCHOOL-01 (G1): a task that is the PAIRED task of a class assessment (class_assessments.task_id) must not
  // drift from it. addClassAssessmentCore/updateClassAssessmentCore already push assessment -> task; this is the
  // other direction, so editing the task in the School task list shows up in the Assessments module, the risk
  // panel and the grade ledger. Only name, date and (an assessable) type travel; a task that has no assessment
  // is untouched, and an emptied date never blanks the assessment's NOT NULL date.
  const { data: linked, error: linkError } = await supabase.from("class_assessments").select("id").eq("task_id", id).eq("user_id", userId).maybeSingle();
  if (linkError) throw linkError;
  if (linked) {
    const patch: { name: string; date?: string; type?: string } = { name: input.title };
    if (input.dueDate) patch.date = input.dueDate;
    if (taskType && isAssessmentType(taskType)) patch.type = normalizeAssessmentType(taskType);
    const { error: assessmentError } = await supabase.from("class_assessments").update(patch).eq("id", linked.id).eq("user_id", userId);
    if (assessmentError) throw assessmentError;
  }
}

export interface ToggleTaskResult {
  completed: boolean;
}

export async function toggleTaskCore(supabase: SupabaseClient, userId: string, id: string): Promise<ToggleTaskResult> {
  const { data: existing } = await supabase
    .from("tasks")
    .select("completed, kill_list_item_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) throw new Error("Task not found");

  const nowCompleted = !existing.completed;
  const { error } = await supabase
    .from("tasks")
    .update({ completed: nowCompleted, completed_at: nowCompleted ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await syncKillListFromTask(supabase, userId, existing.kill_list_item_id, nowCompleted, nowCompleted ? new Date().toISOString() : null);
  return { completed: nowCompleted };
}

/**
 * SETS (not toggles) a task's completion -- the optimistic school UI sends its intended
 * value so queued/duplicate taps are idempotent (PERF-3; same reasoning as setAdhkarCore).
 */
export async function setTaskCompletedCore(supabase: SupabaseClient, userId: string, id: string, completed: boolean): Promise<ToggleTaskResult> {
  const { data, error } = await supabase
    .from("tasks")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, kill_list_item_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Task not found");
  await syncKillListFromTask(supabase, userId, data[0].kill_list_item_id as string | null, completed, completed ? new Date().toISOString() : null);
  return { completed };
}

/** A real DELETE — not reachable from lib/mcp/write-registry.ts. See this file's header comment. */
export async function removeTaskCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  // SCHOOL-01 (G1): removing the PAIRED task of a class assessment removes the assessment too (the same pair
  // delete_class_assessment removes from the other side); otherwise an orphan assessment (task_id nulled by the
  // FK) would keep showing in the Assessments module and the risk panel after the user deleted it.
  const { data: linked, error: linkError } = await supabase.from("class_assessments").select("id").eq("task_id", id).eq("user_id", userId).maybeSingle();
  if (linkError) throw linkError;
  const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  if (linked) {
    const { error: assessmentError } = await supabase.from("class_assessments").delete().eq("id", linked.id).eq("user_id", userId);
    if (assessmentError) throw assessmentError;
  }
}

/**
 * P2-06 timeboxing — a narrow, single-field update, deliberately NOT folded
 * into `updateTaskCore` (that one is Item 5's full-replace Edit popup,
 * mandatory `title` and all; forcing every timebox-panel caller to also
 * resend the title for an inline "set a start time" affordance is the
 * wrong shape, same reasoning P2-05's `saveMySleepIntent` stayed its own
 * narrow action rather than folding into a generic profile update).
 * `time: null` clears it — a deliberate "no start time" is a real state,
 * not an error, same posture as `clearSleepIntent`. Format validation
 * (`isValidBedtime` — reused, not duplicated, from
 * lib/night-plan/sleep-intent.ts, since the shape is identical) happens at
 * the Server Action layer, not here; this core trusts its caller for
 * shape, matching every other core in this file.
 */
export async function setTaskPlannedStartTimeCore(supabase: SupabaseClient, userId: string, id: string, time: string | null): Promise<void> {
  const { error } = await supabase.from("tasks").update({ planned_start_time: time }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function addScheduleEventCore(
  supabase: SupabaseClient,
  userId: string,
  domain: TaskDomain,
  title: string,
  options: {
    isRecurring: boolean;
    dayOfWeek?: number;
    eventDate?: string;
    eventTime?: string;
    endTime?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("schedule_events").insert({
    user_id: userId,
    domain,
    title,
    is_recurring: options.isRecurring,
    day_of_week: options.isRecurring ? options.dayOfWeek : null,
    event_date: options.isRecurring ? null : options.eventDate,
    event_time: options.eventTime ?? null,
    end_time: options.endTime ?? null,
  });
  if (error) throw error;
}

/** Permanent edit of a recurring schedule_events row's own day/time — e.g. Work's "edit hours permanently" (item 4), School's "change the class permanently." Never touches other rows; a multi-day pattern here is several independent rows, not a group. */
export async function updateScheduleEventCore(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  options: { dayOfWeek: number; eventTime: string; endTime?: string }
): Promise<void> {
  const { error } = await supabase
    .from("schedule_events")
    .update({ day_of_week: options.dayOfWeek, event_time: options.eventTime, end_time: options.endTime ?? null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

/** A real DELETE — not reachable from lib/mcp/write-registry.ts. See this file's header comment. */
export async function removeScheduleEventCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("schedule_events").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/**
 * A temporary hours/time change for ONE occurrence — "move next Tuesday's
 * class" / "temporarily for this week or next week" (item 4) — distinct
 * from cancelling (removal) and from editing the permanent pattern (affects
 * every future week). Upsert: a second temporary edit on the same date
 * replaces the first rather than erroring, same idempotent-on-conflict shape
 * as cancellation.
 *
 * Also clears any existing cancellation for the same occurrence (Opus Lead
 * ruling): setting an override on a cancelled date means "actually I am
 * working/in class, at these hours" — a stronger, more specific statement
 * than the cancellation it supersedes. The reverse never happens
 * automatically — cancelScheduleOccurrenceCore does not touch this table —
 * an override stays in place underneath a cancellation so undoing it
 * restores the changed hours, not the permanent ones.
 */
export async function setScheduleEventOverrideCore(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  date: string,
  eventTime: string,
  endTime?: string
): Promise<void> {
  const { error: upsertError } = await supabase
    .from("schedule_event_overrides")
    .upsert(
      { event_id: eventId, user_id: userId, date, event_time: eventTime, end_time: endTime ?? null },
      { onConflict: "event_id,date" }
    );
  if (upsertError) throw upsertError;

  const { error: deleteError } = await supabase
    .from("schedule_event_cancellations")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("date", date);
  if (deleteError) throw deleteError;
}

/** Reverts a single occurrence back to its permanent pattern's own time. A real DELETE — not reachable from lib/mcp/write-registry.ts. See this file's header comment and docs/ai-connector/SCHOOL-WRITE-SCOPE-DECISIONS.md. */
export async function removeScheduleEventOverrideCore(supabase: SupabaseClient, userId: string, eventId: string, date: string): Promise<void> {
  const { error } = await supabase
    .from("schedule_event_overrides")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("date", date);
  if (error) throw error;
}

/**
 * Single-date exception: cancels one occurrence of a recurring event
 * without touching the recurring pattern itself — "cancel this one
 * instance." Recorded in schedule_event_cancellations (migration 046), not
 * the old single-column `schedule_events.cancelled_on` — that column could
 * hold only one cancelled occurrence per event at a time, so cancelling a
 * second occurrence silently un-cancelled the first. `on conflict do
 * nothing` makes a repeat cancel of the same occurrence a no-op rather than
 * an error.
 */
export async function cancelScheduleOccurrenceCore(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  date: string
): Promise<void> {
  const { error } = await supabase
    .from("schedule_event_cancellations")
    .upsert({ event_id: eventId, user_id: userId, date }, { onConflict: "event_id,date", ignoreDuplicates: true });
  if (error) throw error;
}

/** Undoes a single cancelled occurrence — the counterpart every cancel UI must offer, since there is otherwise no way back short of writing SQL directly (see migration 046's own header comment). A real DELETE — not reachable from lib/mcp/write-registry.ts. See this file's header comment and docs/ai-connector/SCHOOL-WRITE-SCOPE-DECISIONS.md. */
export async function uncancelScheduleOccurrenceCore(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  date: string
): Promise<void> {
  const { error } = await supabase
    .from("schedule_event_cancellations")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("date", date);
  if (error) throw error;
}
