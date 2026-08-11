"use client";

import { useOptimistic, useState, useTransition } from "react";
import { addHabit, removeHabit, toggleHabit } from "@/app/(app)/fitness/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type HabitData = { id: string; name: string; completedToday: boolean };

function HabitRow({
  date,
  habit,
  onToggle,
}: {
  date: string;
  habit: HabitData;
  onToggle: (id: string, completed: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            onToggle(habit.id, !habit.completedToday);
            await toggleHabit(habit.id, date);
          })
        }
        aria-label={habit.completedToday ? "Mark incomplete" : "Mark complete"}
        className={cn(
          "size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50",
          habit.completedToday ? "border-accent-fitness bg-accent-fitness" : "border-border"
        )}
      />
      <span className="flex-1 text-sm">{habit.name}</span>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => removeHabit(habit.id))}
        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Remove
      </button>
    </li>
  );
}

export function HabitList({ date, habits }: { date: string; habits: HabitData[] }) {
  const [isAdding, startAddTransition] = useTransition();
  const [newHabit, setNewHabit] = useState("");
  const [optimisticHabits, setOptimisticCompletion] = useOptimistic(
    habits,
    (state, { id, completed }: { id: string; completed: boolean }) =>
      state.map((h) => (h.id === id ? { ...h, completedToday: completed } : h))
  );

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newHabit.trim();
    if (!trimmed) return;
    startAddTransition(async () => {
      await addHabit(trimmed);
      setNewHabit("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {optimisticHabits.map((h) => (
          <HabitRow
            key={h.id}
            date={date}
            habit={h}
            onToggle={(id, completed) => setOptimisticCompletion({ id, completed })}
          />
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={newHabit}
          onChange={(e) => setNewHabit(e.target.value)}
          placeholder="Add a habit"
        />
        <Button type="submit" disabled={isAdding}>
          Add
        </Button>
      </form>
    </div>
  );
}
