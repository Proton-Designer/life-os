"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TaskData = {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  completed: boolean;
};

export function TaskList({
  tasks,
  addTask,
  toggleTask,
  removeTask,
}: {
  tasks: TaskData[];
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

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3"
          >
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => toggleTask(task.id))}
              aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
              className={cn(
                "size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50",
                task.completed ? "border-accent-school bg-accent-school" : "border-border"
              )}
            />
            <span className={cn("flex-1 text-sm", task.completed && "text-muted-foreground line-through")}>
              {task.title}
            </span>
            {task.dueDate && (
              <span className="text-xs text-muted-foreground">{task.dueDate}</span>
            )}
            <button
              type="button"
              onClick={() => startTransition(() => removeTask(task.id))}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" />
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-40"
        />
        <Button type="submit" disabled={isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}
