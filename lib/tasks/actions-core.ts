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
  });
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
