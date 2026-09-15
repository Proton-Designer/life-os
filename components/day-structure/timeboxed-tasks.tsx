"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setTaskPlannedStartTime, clearTaskPlannedStartTime } from "@/app/(app)/open/today/timebox-actions";
import { isValidBedtime } from "@/lib/night-plan/sleep-intent";
import type { TimeboxedTask } from "@/lib/day-structure/timebox";
import { cn } from "@/lib/utils";

/**
 * Phase 2 #P2-06 — timeboxing on Merged Today. Renders Night Plan's
 * already-established "today's plan" set (the starred/crowned items,
 * `mit_rank IS NOT NULL` — see lib/day-structure/timebox.ts's own header)
 * in TIMELINE ORDER, each with an editable "HH:MM" planned start time.
 *
 * NO DURATION/ESTIMATE INPUT ANYWHERE HERE, DELIBERATELY — a start time
 * only, matching night-plan.ts's own explicit absence of any duration
 * estimate. Adding a "how long will this take" field here would silently
 * reintroduce the exact thing that file's header calls out.
 */
export function TimeboxedTasks({ tasks }: { tasks: TimeboxedTask[] }) {
  if (tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
      <span className="text-sm font-medium">Today's plan</span>
      <ul className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <TimeboxRow key={task.id} task={task} />
        ))}
      </ul>
    </div>
  );
}

function TimeboxRow({ task }: { task: TimeboxedTask }) {
  const [input, setInput] = useState(task.plannedStartTime ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!isValidBedtime(input)) {
      setError("Enter a time as HH:MM.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setTaskPlannedStartTime(task.id, input);
      if (!res.ok) setError(res.message);
    });
  }

  function handleClear() {
    setError(null);
    startTransition(async () => {
      const res = await clearTaskPlannedStartTime(task.id);
      if (res.ok) setInput("");
      else setError(res.message);
    });
  }

  return (
    <li
      data-testid={`timebox-row-${task.id}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 px-3 py-1.5"
    >
      <span className={cn("truncate text-sm", task.completed && "text-muted-foreground line-through")}>{task.title}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={input}
          disabled={isPending}
          onChange={(e) => setInput(e.target.value)}
          aria-label={`Planned start time for ${task.title}`}
          className="rounded-md border border-border/50 bg-transparent px-2 py-1 text-xs"
        />
        <Button size="sm" variant="outline" disabled={isPending} onClick={handleSave}>
          Save
        </Button>
        {task.plannedStartTime && (
          <Button size="sm" variant="ghost" disabled={isPending} onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </li>
  );
}
