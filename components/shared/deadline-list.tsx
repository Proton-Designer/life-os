"use client";

import { useTransition } from "react";
import { formatDeadlineLabel } from "@/lib/tasks/deadline-label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { CalendarClock } from "lucide-react";

export type DeadlineTaskData = { id: string; title: string; dueDate: string; dueTime: string | null };

// Read-mostly digest of what's actually due, sorted soonest-first — the
// detail the KPI row's Due today/Overdue counts summarize (one-metric
// rule). Deliberately no add/remove here: that stays exclusively in the
// Task list panel below, so there's one place to manage tasks and one
// place to see what's coming due, not two overlapping forms.
export function DeadlineList({
  tasks,
  todayStr,
  toggleTask,
}: {
  tasks: DeadlineTaskData[];
  todayStr: string;
  toggleTask: (id: string) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  if (tasks.length === 0) {
    return (
      <EmptyState icon={CalendarClock} message="Nothing due yet" action={{ label: "Add a task", href: "#task-list-add" }} />
    );
  }

  const sorted = [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((t) => {
        const { label, variant } = formatDeadlineLabel(t.dueDate, todayStr);
        return (
          <li key={t.id} className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => toggleTask(t.id))}
              aria-label="Mark complete"
              className={cn("size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50", "border-border")}
            />
            <span className="flex-1 text-sm">{t.title}</span>
            <Badge variant={variant}>{label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
