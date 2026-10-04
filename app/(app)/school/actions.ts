"use server";

import { revalidatePath } from "next/cache";
import {
  addTaskCore,
  updateTaskCore,
  toggleTaskCore,
  setTaskCompletedCore,
  removeTaskCore,
  addScheduleEventCore,
  cancelScheduleOccurrenceCore,
  uncancelScheduleOccurrenceCore,
  type TaskType,
} from "@/lib/tasks/actions-core";
import { requireUser } from "@/lib/supabase/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string) {
  if (!UUID_RE.test(value)) throw new Error(`${label} is not a valid id`);
}

export async function addTask(input: {
  title: string;
  dueDate?: string;
  dueTime?: string;
  taskType?: TaskType;
  taskTypeOtherLabel?: string;
  classId?: string | null;
}): Promise<void> {
  const { supabase, userId } = await requireUser();
  await addTaskCore(supabase, userId, { domain: "school", ...input });
  revalidatePath("/school");
  revalidatePath("/");
}

export async function updateTask(
  id: string,
  input: { title: string; dueDate?: string; taskType?: TaskType; taskTypeOtherLabel?: string; classId?: string | null }
): Promise<void> {
  const { supabase, userId } = await requireUser();
  await updateTaskCore(supabase, userId, id, input);
  revalidatePath("/school");
  revalidatePath("/");
}

export async function toggleTask(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await toggleTaskCore(supabase, userId, id);
  revalidatePath("/school");
  revalidatePath("/");
}

/**
 * Idempotent "mark done" for the school task lists (PERF-3). Hot tap: no
 * revalidatePath here -- callers schedule ONE refreshSchoolViews() after a burst.
 */
export async function completeTask(id: string): Promise<void> {
  assertUuid(id, "task id");
  const { supabase, userId } = await requireUser();
  await setTaskCompletedCore(supabase, userId, id, true);
}

/** Data-free cache revalidation for the surfaces a school task tap feeds (School + Home). */
export async function refreshSchoolViews(): Promise<void> {
  await requireUser();
  revalidatePath("/school");
  revalidatePath("/");
}

export async function removeTask(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await removeTaskCore(supabase, userId, id);
  revalidatePath("/school");
  revalidatePath("/");
}

export async function addScheduleEvent(
  title: string,
  options: { isRecurring: boolean; dayOfWeek?: number; eventDate?: string; eventTime?: string }
): Promise<void> {
  const { supabase, userId } = await requireUser();
  await addScheduleEventCore(supabase, userId, "school", title, options);
  revalidatePath("/school");
}

export async function cancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await cancelScheduleOccurrenceCore(supabase, userId, eventId, date);
  revalidatePath("/school");
}

export async function uncancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await uncancelScheduleOccurrenceCore(supabase, userId, eventId, date);
  revalidatePath("/school");
}

export type ClassEventInput = {
  title: string;
  /** 0=Sun..6=Sat, at least one — a T/Th class is `[2, 4]`. */
  days: number[];
  eventTime?: string;
  endTime?: string;
  location?: string;
  instructor?: string;
  /** Links these rows to a `classes` entity (evening batch, 2026-08-26's
   * Add-class popup) — optional and unused by ClassEditorDialog's own
   * add/edit flow, which predates the `classes` table's per-class entity
   * and has no class_id to attach. */
  classId?: string | null;
};

/**
 * A multi-day class (Ayman: "the class is T/TH" — singular) is stored as
 * one schedule_events row per day, all sharing one class_group_id
 * (migration 046) so "edit this class"/"remove this class" always operate
 * on the whole thing, never orphaning half of it.
 */
export async function addClassEvent(input: ClassEventInput): Promise<void> {
  const { supabase, userId } = await requireUser();
  const days = Array.from(new Set(input.days)).sort((a, b) => a - b);
  if (days.length === 0) throw new Error("Select at least one day");

  const groupId = days.length > 1 ? crypto.randomUUID() : null;
  const { error } = await supabase.from("schedule_events").insert(
    days.map((dayOfWeek) => ({
      user_id: userId,
      domain: "school" as const,
      title: input.title,
      is_recurring: true,
      day_of_week: dayOfWeek,
      event_time: input.eventTime ?? null,
      end_time: input.endTime ?? null,
      location: input.location ?? null,
      instructor: input.instructor ?? null,
      class_group_id: groupId,
      class_id: input.classId ?? null,
    }))
  );
  if (error) throw error;
  revalidatePath("/school");
}

/**
 * `key` is the class's class_group_id if it has one, otherwise the id of
 * its single row (a single-day class not yet promoted to a group) — same
 * value the School UI groups classes by. Rows for days still selected are
 * updated IN PLACE, never deleted and reinserted: tasks.class_event_id
 * references a specific schedule_events row (ON DELETE SET NULL), and
 * dropping/recreating every row on every edit would silently sever that
 * link the moment a class's time or room changed.
 */
export async function updateClassEvent(key: string, input: ClassEventInput): Promise<void> {
  assertUuid(key, "key");
  const { supabase, userId } = await requireUser();
  const days = Array.from(new Set(input.days)).sort((a, b) => a - b);
  if (days.length === 0) throw new Error("Select at least one day");

  const { data: existingRows, error: fetchError } = await supabase
    .from("schedule_events")
    .select("id, day_of_week, class_group_id")
    .eq("user_id", userId)
    .or(`class_group_id.eq.${key},id.eq.${key}`);
  if (fetchError) throw fetchError;
  if (!existingRows || existingRows.length === 0) throw new Error("Class not found");

  // A previously-ungrouped single row is promoted to a real group the
  // moment it needs a second day — reusing its own id as the shared label
  // keeps `key` stable across the edit rather than minting an unrelated one.
  const groupId = existingRows[0].class_group_id ?? existingRows[0].id;
  const existingDays = new Set(existingRows.map((r) => r.day_of_week));
  const keepRows = existingRows.filter((r) => days.includes(r.day_of_week as number));
  const dropRows = existingRows.filter((r) => !days.includes(r.day_of_week as number));
  const newDays = days.filter((d) => !existingDays.has(d));

  const common = {
    title: input.title,
    event_time: input.eventTime ?? null,
    end_time: input.endTime ?? null,
    location: input.location ?? null,
    instructor: input.instructor ?? null,
    class_group_id: groupId,
  };

  if (keepRows.length > 0) {
    const { error } = await supabase
      .from("schedule_events")
      .update(common)
      .in(
        "id",
        keepRows.map((r) => r.id)
      )
      .eq("user_id", userId);
    if (error) throw error;
  }

  if (dropRows.length > 0) {
    const { error } = await supabase
      .from("schedule_events")
      .delete()
      .in(
        "id",
        dropRows.map((r) => r.id)
      )
      .eq("user_id", userId);
    if (error) throw error;
  }

  if (newDays.length > 0) {
    const { error } = await supabase.from("schedule_events").insert(
      newDays.map((dayOfWeek) => ({
        user_id: userId,
        domain: "school" as const,
        is_recurring: true,
        day_of_week: dayOfWeek,
        ...common,
      }))
    );
    if (error) throw error;
  }

  revalidatePath("/school");
}

/**
 * Removes the SCHEDULE EVENTS of the class identified by `key` (see
 * updateClassEvent's header comment for what `key` is) — its meetings come
 * off the timetable and nothing else changes.
 *
 * IT DOES NOT DELETE THE CLASS. This comment used to claim it "removes every
 * row belonging to the class," which is false, and the overstatement cost
 * real data confusion: with no class-delete anywhere in the app, this was the
 * closest thing to one, so removing a class from the schedule left the class
 * row, its assessments and all of its coursework in place with nothing
 * pointing at them. Found 2026-09-10 on a real account — an AMS class whose
 * events were gone while 29 tasks and 2 assessments were still attached to a
 * live class row.
 *
 * To delete a class and everything under it, use `deleteClass`
 * (class-actions.ts). A comment that overstates what a function does is worse
 * than no comment: it stops the next person looking for the function that
 * actually exists.
 */
export async function removeClassEvent(key: string): Promise<void> {
  assertUuid(key, "key");
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("schedule_events")
    .delete()
    .eq("user_id", userId)
    .or(`class_group_id.eq.${key},id.eq.${key}`);
  if (error) throw error;
  revalidatePath("/school");
}
