"use client";

import { Check, Circle } from "lucide-react";
import { castHabitVoteAction, retractHabitVoteAction, refreshHabitViews } from "@/app/(app)/habits/actions";
import { setDeenHabitLogStatus, refreshFaithPracticeViews } from "@/app/(app)/deen/actions";
import type { FaithPractice } from "@/lib/deen/practices";
import { useOptimisticItem } from "@/lib/client/use-optimistic-item";
import type { HabitWithStatus } from "@/lib/habits/queries";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshHabits = () => refreshHabitViews();
const refreshFaith = () => refreshFaithPracticeViews();

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

function PracticeRow({ practice, today }: { practice: FaithPractice; today: string }) {
  // ABSOLUTE write through the same action the Faith screen uses, its own queue key per practice/day.
  const log = useOptimisticItem<boolean>({
    serverValue: practice.completedToday,
    queueKey: `deen-habit:${practice.id}:${today}`,
    write: (next) => setDeenHabitLogStatus(practice.id, today, next),
    refresh: refreshFaith,
  });
  const done = log.value;

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        onClick={() => void log.set(!done)}
        data-testid="faith-practice-checkoff"
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
          done ? "border-primary/40 bg-primary/5" : "border-border/60 hover:bg-foreground/[0.03]"
        )}
      >
        {done ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", done && "text-muted-foreground line-through")}>{practice.name}</span>
          {practice.anchorCue ? <span className="block truncate text-xs text-muted-foreground">{practice.anchorCue}</span> : null}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Faith</span>
      </button>
      {log.error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {log.error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Daily habit check-offs on Home (IA-P3b): today's vote for each active identity habit in one tap,
 * without opening the habits board, then the Faith practices (`faithPractices`, only passed when Deen Mode is
 * ON). Renders nothing when both lists are empty. Identity habits carry no Deen tag.
 */
export function HabitCheckoffs({
  habits,
  faithPractices = [],
  today,
}: {
  habits: HabitWithStatus[];
  faithPractices?: FaithPractice[];
  today: string;
}) {
  if (habits.length === 0 && faithPractices.length === 0) return null;
  return (
    <Panel title="Habits" data-testid="habit-checkoffs">
      <ul className="flex flex-col gap-2">
        {habits.map((h) => (
          <CheckoffRow key={h.id} habit={h} today={today} />
        ))}
        {faithPractices.map((p) => (
          <PracticeRow key={p.id} practice={p} today={today} />
        ))}
      </ul>
    </Panel>
  );
}
