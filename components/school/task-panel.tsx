"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TaskRowList, type TaskRowItem } from "@/components/shared/task-row-list";

/**
 * School's own tap-to-complete task list (2026-08-25 rollout of
 * TaskRowList to the domain screens, Opus Lead) — the client-side wrapper
 * TaskRowList's own doc comment requires: Server Actions imported and
 * called here, never passed in as closures from page.tsx across the RSC
 * boundary (AGENTS.md). Adding a task stays outside TaskRowList entirely —
 * that was never part of its contract (only complete/log/remove), so the
 * add form is plain local UI here, same shape the old TaskList component
 * used.
 */
export function SchoolTaskPanel({
  items,
  addTask,
  toggleTask,
  removeTask,
}: {
  items: TaskRowItem[];
  addTask: (title: string, dueDate?: string, dueTime?: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await addTask(trimmed, dueDate || undefined);
      setTitle("");
      setDueDate("");
    });
  }

  async function handleComplete(item: TaskRowItem) {
    await toggleTask(item.id);
  }

  async function handleRemove(item: TaskRowItem) {
    await removeTask(item.id);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* No count/choice tasks exist on School's list today — onLog is
          omitted rather than passed as a throwing stub. TaskRowList
          degrades a log-mode row to inert (disabled, console.error) when
          onLog is absent instead of throwing, so a future log-mode school
          task fails visibly/quietly rather than as an exception thrown
          inside a transition on a screen Ayman uses daily (Opus Lead,
          2026-08-25 — the same ruling A applied to next-actions.tsx). */}
      <TaskRowList items={items} onComplete={handleComplete} onRemove={handleRemove} />
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input id="task-list-add" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" />
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-40" />
        <Button type="submit" disabled={isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}
