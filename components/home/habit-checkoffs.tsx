"use client";

import { Check, Circle } from "lucide-react";
import { castHabitVoteAction, retractHabitVoteAction, refreshHabitViews } from "@/app/(app)/habits/actions";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import type { HabitWithStatus } from "@/lib/habits/queries";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshHabits = () => refreshHabitViews();

function CheckoffRow({ habit, today }: { habit: HabitWithStatus; today: string }) {
  // Same per-habit queue key as the habits board (components/habits/habit-list.tsx), so a vote
  // tapped here and one tapped there stay ordered. ABSOLUTE cast/retract writes, last tap wins,
  // nothing disabled while one saves, one deferred refresh.
  const vote = useOptimisticItem<boolean>({
    serverValue: habit.votedToday,
    queueKey: `habit-vote:${habit.id}:${today}`,
    write: async (next) => {
      const res = next ? await castHabitVoteAction(habit.id, today) : await retractHabitVoteAction(habit.id, today);
      if ("error" in res) throw new Error(res.error);
    },
    refresh: refreshHabits,
  });
  const voted = vote.value;

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={voted}
        onClick={() => void vote.set(!voted)}
        data-testid="habit-checkoff"
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
          voted ? "border-primary/40 bg-primary/5" : "border-border/60 hover:bg-foreground/[0.03]"
        )}
      >
        {voted ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className={cn("min-w-0 flex-1 truncate", voted && "text-muted-foreground line-through")}>{habit.identityStatement}</span>
      </button>
      {vote.error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {vote.error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Daily habit check-offs on Home (IA-P3b): today's vote for each active identity habit in one tap,
 * without opening the habits board. Renders nothing when there are no active habits. Habits carry
 * no Deen tag, so there is nothing to filter for Deen Mode.
 */
export function HabitCheckoffs({ habits, today }: { habits: HabitWithStatus[]; today: string }) {
  if (habits.length === 0) return null;
  return (
    <Panel title="Habits today" data-testid="habit-checkoffs">
      <ul className="flex flex-col gap-2">
        {habits.map((h) => (
          <CheckoffRow key={h.id} habit={h} today={today} />
        ))}
      </ul>
    </Panel>
  );
}
