"use client";

import { useState, useTransition } from "react";
import { addHabit, removeHabit, toggleHabit } from "@/app/(app)/fitness/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type HabitData = { id: string; name: string; completedToday: boolean };

export function HabitList({ date, habits }: { date: string; habits: HabitData[] }) {
  const [isPending, startTransition] = useTransition();
  const [newHabit, setNewHabit] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newHabit.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await addHabit(trimmed);
      setNewHabit("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {habits.map((h) => (
          <li
            key={h.id}
            className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3"
          >
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => toggleHabit(h.id, date))}
              aria-label={h.completedToday ? "Mark incomplete" : "Mark complete"}
              className={cn(
                "size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50",
                h.completedToday ? "border-accent-fitness bg-accent-fitness" : "border-border"
              )}
            />
            <span className="flex-1 text-sm">{h.name}</span>
            <button
              type="button"
              onClick={() => startTransition(() => removeHabit(h.id))}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={newHabit}
          onChange={(e) => setNewHabit(e.target.value)}
          placeholder="Add a habit"
        />
        <Button type="submit" disabled={isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}
