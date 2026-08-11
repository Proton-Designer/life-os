import { requireUser } from "@/lib/supabase/auth";

export type TaskDomain = "school" | "co_op";

export async function addTaskCore(
  domain: TaskDomain,
  title: string,
  dueDate?: string,
  dueTime?: string
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("tasks").insert({
    user_id: userId,
    domain,
    title,
    due_date: dueDate ?? null,
    due_time: dueTime ?? null,
  });
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

  const { error } = await supabase
    .from("tasks")
    .update({ completed: !existing.completed })
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
 * touching the recurring pattern itself, per spec. Note the schema's
 * `cancelled_on` is a single column, not a list — this can represent only
 * one cancelled occurrence per event at a time (matches Task 1.1's original
 * schema and Task 8.1's literal acceptance criteria; a true multi-exception
 * calendar would need a separate exceptions table, out of scope here).
 */
export async function cancelScheduleOccurrenceCore(
  eventId: string,
  date: string
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("schedule_events")
    .update({ cancelled_on: date })
    .eq("id", eventId)
    .eq("user_id", userId);
  if (error) throw error;
}
