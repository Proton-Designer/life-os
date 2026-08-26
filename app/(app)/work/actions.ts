"use server";

import { revalidatePath } from "next/cache";
import {
  addScheduleEventCore,
  cancelScheduleOccurrenceCore,
  uncancelScheduleOccurrenceCore,
} from "@/lib/tasks/actions-core";

export async function addScheduleEvent(
  title: string,
  options: { isRecurring: boolean; dayOfWeek?: number; eventDate?: string; eventTime?: string }
): Promise<void> {
  await addScheduleEventCore("co_op", title, options);
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
