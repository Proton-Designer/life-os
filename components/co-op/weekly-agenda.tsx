"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TaskCard } from "@/components/co-op/task-card";
import { agendaTasks, type CoopTaskRow, type CoopTaskStatus } from "@/lib/coop/tasks";
import {
  addAgendaTask,
  editTask,
  removeTask,
  advanceTask,
  retreatTask,
  blockTask,
  unblockTask,
} from "@/app/(app)/co-op/tasks-actions";

/**
 * The creation-and-list surface over the current target's tasks (Opus
 * Lead ruling 1 — same rows the pipeline board renders below, just a
 * different view). Scoped to Target 1 only: with no current target
 * there's nothing to scope tasks to, so the caller doesn't render this
 * at all (matches the Targets strip's pre-target single-CTA rule).
 */
export function WeeklyAgenda({ targetId, tasks }: { targetId: string; tasks: CoopTaskRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await addAgendaTask(targetId, trimmed, deadline || undefined);
      setTitle("");
      setDeadline("");
      setAdding(false);
    });
  }

  function taskActions(task: CoopTaskRow) {
    const status = task.status as Exclude<CoopTaskStatus, "blocked">;
    const blockedFrom = task.blockedFrom;
    return {
      onAdvance: () => startTransition(() => advanceTask(task.id, status)),
      onRetreat: () => startTransition(() => retreatTask(task.id, status)),
      onBlock: () => startTransition(() => blockTask(task.id, status)),
      onUnblock: () => {
        if (blockedFrom) startTransition(() => unblockTask(task.id, blockedFrom));
      },
      onEdit: (newTitle: string) => startTransition(() => editTask(task.id, { title: newTitle })),
      onRemove: () => startTransition(() => removeTask(task.id)),
    };
  }

  const visible = agendaTasks(tasks);

  return (
    <div className="flex flex-col gap-3">
      {visible.length === 0 && !adding && <p className="py-4 text-center text-sm text-muted-foreground">Nothing on the agenda yet</p>}

      {visible.map((task) => (
        <TaskCard key={task.id} task={task} isPending={isPending} {...taskActions(task)} />
      ))}

      {adding ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus />
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="Deadline (optional)" />
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending || !title.trim()}>
              Add task
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)} className="w-fit">
          + Add a task
        </Button>
      )}
    </div>
  );
}
