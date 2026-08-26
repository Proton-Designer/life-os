import { requireUser } from "@/lib/supabase/auth";
import type { TaskType } from "./task-type";

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

export async function addTaskCore(input: AddTaskInput): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("tasks").insert({
    user_id: userId,
    domain: input.domain,
    title: input.title,
    due_date: input.dueDate ?? null,
    due_time: input.dueTime ?? null,
    task_type: input.taskType ?? null,
    task_type_other_label: input.taskType === "other" ? (input.taskTypeOtherLabel ?? null) : null,
    class_id: input.classId ?? null,
  });
  if (error) throw error;
}

export type UpdateTaskInput = {
  title: string;
  dueDate?: string;
  taskType?: TaskType;
  taskTypeOtherLabel?: string;
  classId?: string | null;
};

/** Item 5's Edit popup: "change the contents of any task." Full-replace update, scoped by id + user_id like every other task mutation here. */
export async function updateTaskCore(id: string, input: UpdateTaskInput): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("tasks")
    .update({
      title: input.title,
      due_date: input.dueDate ?? null,
      task_type: input.taskType ?? null,
      task_type_other_label: input.taskType === "other" ? (input.taskTypeOtherLabel ?? null) : null,
      class_id: input.classId ?? null,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function toggleTaskCore(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("tasks")
    .select("completed")
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
}

export async function removeTaskCore(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function addScheduleEventCore(
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
  const { supabase, userId } = await requireUser();
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

/** Permanent edit of a recurring schedule_events row's own day/time — e.g. Work's "edit hours permanently" (item 4). Never touches other rows; a multi-day pattern here is several independent rows, not a group. */
export async function updateScheduleEventCore(
  id: string,
  options: { dayOfWeek: number; eventTime: string; endTime?: string }
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("schedule_events")
    .update({ day_of_week: options.dayOfWeek, event_time: options.eventTime, end_time: options.endTime ?? null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function removeScheduleEventCore(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("schedule_events").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/**
 * A temporary hours change for ONE occurrence — "temporarily for this week
 * or next week" (item 4) — distinct from cancelling (removal) and from
 * editing the permanent pattern (affects every future week). Upsert: a
 * second temporary edit on the same date replaces the first rather than
 * erroring, same idempotent-on-conflict shape as cancellation.
 *
 * Also clears any existing cancellation for the same occurrence (Opus Lead
 * ruling): setting an override on a cancelled date means "actually I am
 * working, at these hours" — a stronger, more specific statement than the
 * cancellation it supersedes. The reverse never happens automatically —
 * cancelScheduleOccurrenceCore does not touch this table — an override
 * stays in place underneath a cancellation so undoing it restores the
 * changed hours, not the permanent ones.
 */
export async function setScheduleEventOverrideCore(
  eventId: string,
  date: string,
  eventTime: string,
  endTime?: string
): Promise<void> {
  const { supabase, userId } = await requireUser();
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

/** Reverts a single occurrence back to its permanent pattern's own time. */
export async function removeScheduleEventOverrideCore(eventId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("schedule_event_overrides")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("date", date);
  if (error) throw error;
}

/**
 * Single-date exception: cancels one occurrence of a recurring event without
 * touching the recurring pattern itself, per spec. Recorded in
 * schedule_event_cancellations (migration 046), not the old single-column
 * `schedule_events.cancelled_on` — that column could hold only one cancelled
 * occurrence per event at a time, so cancelling a second occurrence silently
 * un-cancelled the first. `on conflict do nothing` makes a repeat cancel of
 * the same occurrence a no-op rather than an error.
 */
export async function cancelScheduleOccurrenceCore(
  eventId: string,
  date: string
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("schedule_event_cancellations")
    .upsert({ event_id: eventId, user_id: userId, date }, { onConflict: "event_id,date", ignoreDuplicates: true });
  if (error) throw error;
}

/** Undoes a single cancelled occurrence — the counterpart every cancel UI must offer, since there is otherwise no way back short of writing SQL directly (see migration 046's own header comment). */
export async function uncancelScheduleOccurrenceCore(
  eventId: string,
  date: string
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("schedule_event_cancellations")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("date", date);
  if (error) throw error;
}
