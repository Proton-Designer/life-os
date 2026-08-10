"use server";

import { revalidatePath } from "next/cache";
import {
  addTaskCore,
  toggleTaskCore,
  removeTaskCore,
  addScheduleEventCore,
  cancelScheduleOccurrenceCore,
} from "@/lib/tasks/actions-core";

export async function addTask(title: string, dueDate?: string, dueTime?: string): Promise<void> {
  await addTaskCore("co_op", title, dueDate, dueTime);
  revalidatePath("/co-op");
  revalidatePath("/");
}

export async function toggleTask(id: string): Promise<void> {
  await toggleTaskCore(id);
  revalidatePath("/co-op");
  revalidatePath("/");
}

export async function removeTask(id: string): Promise<void> {
  await removeTaskCore(id);
  revalidatePath("/co-op");
}

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
