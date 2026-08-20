"use client";

import { useState, useTransition } from "react";
import { repGoalProgress } from "@/lib/fitness/rep-goal";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type RepGoalBar = {
  exerciseId: string;
  exerciseName: string;
  dailyTarget: number;
  loggedRepsToday: number;
};

/**
 * Two thin bars on Home for the starter plan (spec §5) — only ever the
 * goals active today (caller filters via `isGoalActiveOn` before this
 * renders, so an inactive day shows nothing here at all rather than a
 * greyed-out bar). Each bar IS its own quick-add entry point: tap it, the
 * exercise is already known, just enter this bout's reps — no navigation
 * to Fitness required.
 */
export function RepGoalBars({
  goals,
  onLog,
}: {
  goals: RepGoalBar[];
  onLog: (exerciseId: string, exerciseName: string, reps: number) => Promise<void>;
}) {
  if (goals.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2" data-testid="rep-goal-bars">
      {goals.map((g) => (
        <RepGoalBarRow key={g.exerciseId} goal={g} onLog={onLog} />
      ))}
    </ul>
  );
}

function RepGoalBarRow({
  goal,
  onLog,
}: {
  goal: RepGoalBar;
  onLog: (exerciseId: string, exerciseName: string, reps: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reps, setReps] = useState(1);
  const [isPending, startTransition] = useTransition();

  const progress = repGoalProgress(goal.loggedRepsToday, goal.dailyTarget);

  function handleLog() {
    startTransition(async () => {
      await onLog(goal.exerciseId, goal.exerciseName, reps);
      setExpanded(false);
      setReps(1);
    });
  }

  return (
    <li className="flex flex-col gap-1.5" data-testid={`rep-goal-bar-${goal.exerciseId}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="min-h-11 w-full rounded-lg border border-border/40 p-2 text-left"
      >
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{goal.exerciseName}</span>
          <span className="tabular-nums text-muted-foreground">
            {progress.done}/{progress.target}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full bg-accent-fitness transition-all")}
            style={{ width: `${progress.fraction * 100}%` }}
          />
        </div>
      </button>
      {expanded && (
        <div className="flex items-center gap-2" data-testid={`rep-goal-quick-add-${goal.exerciseId}`}>
          <Input
            type="number"
            aria-label={`${goal.exerciseName} reps this bout`}
            className="w-16"
            value={reps}
            onChange={(e) => setReps(Number(e.target.value))}
          />
          <Button type="button" onClick={handleLog} disabled={isPending}>
            Log
          </Button>
        </div>
      )}
    </li>
  );
}
