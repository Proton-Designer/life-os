"use server";

import { revalidatePath } from "next/cache";
import {
  addScheduleEventCore,
  updateScheduleEventCore,
  removeScheduleEventCore,
  setScheduleEventOverrideCore,
  removeScheduleEventOverrideCore,
  cancelScheduleOccurrenceCore,
  uncancelScheduleOccurrenceCore,
} from "@/lib/tasks/actions-core";

// Item 4 (2026-08-26 night batch 2): "this schedule is just for work, this
// isn't to add new events" — the old generic addScheduleEvent (free-text
// title + Add button) is gone. Every write here is scoped to work hours
// specifically; the title is always "Work", never user-entered.

export async function addWorkHours(dayOfWeek: number, eventTime: string, endTime?: string): Promise<void> {
  await addScheduleEventCore("co_op", "Work", { isRecurring: true, dayOfWeek, eventTime, endTime });
  revalidatePath("/work");
}

export async function updateWorkHours(
  id: string,
  options: { dayOfWeek: number; eventTime: string; endTime?: string }
): Promise<void> {
  await updateScheduleEventCore(id, options);
  revalidatePath("/work");
}

export async function removeWorkHours(id: string): Promise<void> {
  await removeScheduleEventCore(id);
  revalidatePath("/work");
}

/** A one-off extra shift for a single date — already representable as a non-recurring schedule_events row, no new schema needed. */
export async function addOneOffWorkShift(eventDate: string, eventTime: string, endTime?: string): Promise<void> {
  await addScheduleEventCore("co_op", "Work", { isRecurring: false, eventDate, eventTime, endTime });
  revalidatePath("/work");
}

export async function setWorkHoursOverride(
  eventId: string,
  date: string,
  eventTime: string,
  endTime?: string
): Promise<void> {
  await setScheduleEventOverrideCore(eventId, date, eventTime, endTime);
  revalidatePath("/work");
}

export async function removeWorkHoursOverride(eventId: string, date: string): Promise<void> {
  await removeScheduleEventOverrideCore(eventId, date);
  revalidatePath("/work");
}

export async function cancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  await cancelScheduleOccurrenceCore(eventId, date);
  revalidatePath("/work");
}

export async function uncancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  await uncancelScheduleOccurrenceCore(eventId, date);
  revalidatePath("/work");
}
