"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TaskRowList, type TaskRowItem } from "@/components/shared/task-row-list";
import { TASK_TYPE_OPTIONS } from "@/lib/tasks/task-type";
import type { TaskType } from "@/lib/tasks/actions-core";

/**
 * School's own tap-to-complete task list (2026-08-25 rollout of
 * TaskRowList to the domain screens, Opus Lead) — the client-side wrapper
 * TaskRowList's own doc comment requires: Server Actions imported and
 * called here, never passed in as closures from page.tsx across the RSC
 * boundary (AGENTS.md). Adding a task stays outside TaskRowList entirely —
 * that was never part of its contract (only complete/log/remove), so the
 * add form is plain local UI here, same shape the old TaskList component
 * used. Type and Class inputs (2026-08-26, item B2c) are optional — a task
 * with neither set renders an em-dash for both wherever it's listed.
 */
export function SchoolTaskPanel({
  items,
  classOptions,
  addTask,
  toggleTask,
  removeTask,
}: {
  items: TaskRowItem[];
  classOptions: { id: string; title: string }[];
  addTask: (
    title: string,
    dueDate?: string,
    dueTime?: string,
    taskType?: TaskType,
    classEventId?: string
  ) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taskType, setTaskType] = useState("");
  const [classEventId, setClassEventId] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await addTask(
        trimmed,
        dueDate || undefined,
        undefined,
        (taskType || undefined) as TaskType | undefined,
        classEventId || undefined
      );
      setTitle("");
      setDueDate("");
      setTaskType("");
      setClassEventId("");
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
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
        <Input
          id="task-list-add"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          className="min-w-[10rem] flex-1"
        />
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-40" />
        <select
          aria-label="Type"
          value={taskType}
          onChange={(e) => setTaskType(e.target.value)}
          className="rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Type</option>
          {TASK_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Class"
          value={classEventId}
          onChange={(e) => setClassEventId(e.target.value)}
          className="rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Class</option>
          {classOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.title}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}
