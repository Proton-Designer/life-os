"use client";

import { useState, useTransition } from "react";
import { toggleDeenHabitLog, setWeeklyFocus, createDeenHabit } from "@/app/(app)/deen/actions";
import { habitStage } from "@/lib/deen/habit-stage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DeenHabitData = {
  id: string;
  name: string;
  committedDate: string;
  streak: number;
  completedToday: boolean;
};

function HabitToggleButton({
  habitId,
  todayStr,
  completed,
  onToggle,
}: {
  habitId: string;
  todayStr: string;
  completed: boolean;
  onToggle: (habitId: string, completed: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          onToggle(habitId, !completed);
          await toggleDeenHabitLog(habitId, todayStr);
        })
      }
      aria-label={completed ? "Mark incomplete" : "Mark complete"}
      className={cn(
        "size-5 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        completed ? "border-accent-deen bg-accent-deen" : "border-border"
      )}
    />
  );
}

function HabitRow({
  habit,
  todayStr,
  quiet,
  onToggle,
}: {
  habit: DeenHabitData;
  todayStr: string;
  quiet?: boolean;
  onToggle: (habitId: string, completed: boolean) => void;
}) {
  return (
    <li className={cn("flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2", quiet && "opacity-60")}>
      <HabitToggleButton habitId={habit.id} todayStr={todayStr} completed={habit.completedToday} onToggle={onToggle} />
      <span className="flex-1 text-sm">{habit.name}</span>
      {habit.streak > 0 && <span className="text-xs text-muted-foreground">{habit.streak}d</span>}
    </li>
  );
}

function StageColumn({
  title,
  habits,
  todayStr,
  quiet,
  onToggle,
}: {
  title: string;
  habits: DeenHabitData[];
  todayStr: string;
  quiet?: boolean;
  onToggle: (habitId: string, completed: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {habits.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h} todayStr={todayStr} quiet={quiet} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </div>
  );
}

function HabitFocusPicker({
  candidates,
  onDone,
}: {
  candidates: DeenHabitData[];
  onDone: (habitId: string, createdName?: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  function selectExisting(habitId: string) {
    startTransition(async () => {
      await setWeeklyFocus(habitId);
      onDone(habitId);
    });
  }

  function createAndFocus(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const { id } = await createDeenHabit(trimmed);
      await setWeeklyFocus(id);
      onDone(id, trimmed);
      setNewName("");
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/60 p-3">
      {candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          {candidates.map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={isPending}
              onClick={() => selectExisting(h.id)}
              className="rounded-md px-2 py-1 text-left text-sm hover:bg-accent/40 disabled:opacity-50"
            >
              {h.name}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={createAndFocus} className="flex gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Or start a new habit" />
        <Button type="submit" disabled={isPending}>
          Start
        </Button>
      </form>
    </div>
  );
}

export function HabitBuilder({
  todayStr,
  habits: initialHabits,
  currentFocusHabitId,
  previousFocusHabitId,
}: {
  todayStr: string;
  habits: DeenHabitData[];
  currentFocusHabitId: string | null;
  previousFocusHabitId: string | null;
}) {
  const [habits, setHabits] = useState(initialHabits);
  const [focusHabitId, setFocusHabitId] = useState(currentFocusHabitId);
  const [showPicker, setShowPicker] = useState(false);
  const [isContinuing, startContinueTransition] = useTransition();

  function handleToggle(habitId: string, completed: boolean) {
    setHabits((prev) => prev.map((h) => (h.id === habitId ? { ...h, completedToday: completed } : h)));
  }

  function handleFocusChosen(habitId: string, createdName?: string) {
    setFocusHabitId(habitId);
    setShowPicker(false);
    setHabits((prev) =>
      prev.some((h) => h.id === habitId)
        ? prev
        : [...prev, { id: habitId, name: createdName ?? "New habit", committedDate: todayStr, streak: 0, completedToday: false }]
    );
  }

  function continueWithPrevious() {
    if (!previousFocusHabitId) return;
    startContinueTransition(async () => {
      await setWeeklyFocus(previousFocusHabitId);
      handleFocusChosen(previousFocusHabitId);
    });
  }

  const activeBuild = habits.filter((h) => habitStage(h.committedDate, todayStr) === "active_build");
  const stabilized = habits.filter((h) => habitStage(h.committedDate, todayStr) === "stabilized");
  const locked = habits.filter((h) => habitStage(h.committedDate, todayStr) === "locked");

  const focusHabit = habits.find((h) => h.id === focusHabitId) ?? null;
  const previousFocusHabit = habits.find((h) => h.id === previousFocusHabitId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {showPicker ? (
        <HabitFocusPicker
          candidates={activeBuild.filter((h) => h.id !== focusHabitId)}
          onDone={handleFocusChosen}
        />
      ) : focusHabit ? (
        <div className="flex items-center justify-between rounded-lg border border-border/40 p-4">
          <div>
            <div className="text-xs text-muted-foreground">This week&apos;s focus</div>
            <div className="font-medium">{focusHabit.name}</div>
            {focusHabit.streak > 0 && (
              <div className="text-xs text-muted-foreground">{focusHabit.streak} day streak</div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Edit
            </button>
            <HabitToggleButton
              habitId={focusHabit.id}
              todayStr={todayStr}
              completed={focusHabit.completedToday}
              onToggle={handleToggle}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border/60 p-4">
          <p className="text-sm text-muted-foreground">Pick this week&apos;s focus habit.</p>
          {previousFocusHabit && (
            <Button type="button" variant="outline" disabled={isContinuing} onClick={continueWithPrevious}>
              Continue with {previousFocusHabit.name}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {previousFocusHabit ? "Choose different" : "Choose a habit"}
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StageColumn title="Active Build" habits={activeBuild} todayStr={todayStr} onToggle={handleToggle} />
        <StageColumn title="Stabilized" habits={stabilized} todayStr={todayStr} onToggle={handleToggle} />
        <StageColumn title="Locked" habits={locked} todayStr={todayStr} quiet onToggle={handleToggle} />
      </div>
    </div>
  );
}
