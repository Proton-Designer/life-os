import type { BadgeVariant } from "@/components/ui/badge";

function daysBetween(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Relative due-date label + semantic Badge variant for the Deadlines panel. */
export function formatDeadlineLabel(dueDate: string, todayStr: string): { label: string; variant: BadgeVariant } {
  const delta = daysBetween(todayStr, dueDate);
  if (delta < 0) return { label: "Overdue", variant: "negative" };
  if (delta === 0) return { label: "Due today", variant: "warning" };
  if (delta === 1) return { label: "Tomorrow", variant: "neutral" };
  return { label: `In ${delta} days`, variant: "neutral" };
}
