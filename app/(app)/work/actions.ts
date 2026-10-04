"use server";

import { revalidateWorkScreens } from "@/lib/work/revalidate-screens";
import {
  addScheduleEventCore,
  updateScheduleEventCore,
  removeScheduleEventCore,
  setScheduleEventOverrideCore,
  removeScheduleEventOverrideCore,
  cancelScheduleOccurrenceCore,
  uncancelScheduleOccurrenceCore,
} from "@/lib/tasks/actions-core";
import { requireUser } from "@/lib/supabase/auth";

// Item 4 (2026-08-26 night batch 2): "this schedule is just for work, this
// isn't to add new events" — the old generic addScheduleEvent (free-text
// title + Add button) is gone. Every write here is scoped to work hours
// specifically; the title is always "Work", never user-entered.

export async function addWorkHours(dayOfWeek: number, eventTime: string, endTime?: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await addScheduleEventCore(supabase, userId, "co_op", "Work", { isRecurring: true, dayOfWeek, eventTime, endTime });
  revalidateWorkScreens();
}

export async function updateWorkHours(
  id: string,
  options: { dayOfWeek: number; eventTime: string; endTime?: string }
): Promise<void> {
  const { supabase, userId } = await requireUser();
  await updateScheduleEventCore(supabase, userId, id, options);
  revalidateWorkScreens();
}

export async function removeWorkHours(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await removeScheduleEventCore(supabase, userId, id);
  revalidateWorkScreens();
}

/** A one-off extra shift for a single date — already representable as a non-recurring schedule_events row, no new schema needed. */
export async function addOneOffWorkShift(eventDate: string, eventTime: string, endTime?: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await addScheduleEventCore(supabase, userId, "co_op", "Work", { isRecurring: false, eventDate, eventTime, endTime });
  revalidateWorkScreens();
}

export async function setWorkHoursOverride(
  eventId: string,
  date: string,
  eventTime: string,
  endTime?: string
): Promise<void> {
  const { supabase, userId } = await requireUser();
  await setScheduleEventOverrideCore(supabase, userId, eventId, date, eventTime, endTime);
  revalidateWorkScreens();
}

export async function removeWorkHoursOverride(eventId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await removeScheduleEventOverrideCore(supabase, userId, eventId, date);
  revalidateWorkScreens();
}

export async function cancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await cancelScheduleOccurrenceCore(supabase, userId, eventId, date);
  revalidateWorkScreens();
}

export async function uncancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await uncancelScheduleOccurrenceCore(supabase, userId, eventId, date);
  revalidateWorkScreens();
}
