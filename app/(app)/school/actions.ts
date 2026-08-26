"use server";

import { revalidatePath } from "next/cache";
import {
  addTaskCore,
  toggleTaskCore,
  removeTaskCore,
  addScheduleEventCore,
  cancelScheduleOccurrenceCore,
  uncancelScheduleOccurrenceCore,
} from "@/lib/tasks/actions-core";

export async function addTask(title: string, dueDate?: string, dueTime?: string): Promise<void> {
  await addTaskCore("school", title, dueDate, dueTime);
  revalidatePath("/school");
  revalidatePath("/");
}

export async function toggleTask(id: string): Promise<void> {
  await toggleTaskCore(id);
  revalidatePath("/school");
  revalidatePath("/");
}

export async function removeTask(id: string): Promise<void> {
  await removeTaskCore(id);
  revalidatePath("/school");
  revalidatePath("/");
}

export async function addScheduleEvent(
  title: string,
  options: { isRecurring: boolean; dayOfWeek?: number; eventDate?: string; eventTime?: string }
): Promise<void> {
  await addScheduleEventCore("school", title, options);
  revalidatePath("/school");
}

export async function cancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  await cancelScheduleOccurrenceCore(eventId, date);
  revalidatePath("/school");
}

export async function uncancelScheduleOccurrence(eventId: string, date: string): Promise<void> {
  await uncancelScheduleOccurrenceCore(eventId, date);
  revalidatePath("/school");
}
