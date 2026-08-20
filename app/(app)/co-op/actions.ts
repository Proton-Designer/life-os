"use server";

import { revalidatePath } from "next/cache";
import { addScheduleEventCore, cancelScheduleOccurrenceCore } from "@/lib/tasks/actions-core";

export async function addScheduleEvent(
  title: string,
  options: { isRecurring: boolean; dayOfWeek?: number; eventDate?: string; eventTime?: string }
): Promise<void> {
  await addScheduleEventCore("co_op", title, options);
  revalidatePath("/co-op");
}

export async function cancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  await cancelScheduleOccurrenceCore(eventId, date);
  revalidatePath("/co-op");
}
