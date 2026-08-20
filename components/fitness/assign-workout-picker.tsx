"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export type AssignableWorkout = { id: string; name: string };

/**
 * Fills the gap the day-picker/session-detail split otherwise leaves open:
 * without this, a day-picker cell can never acquire a workout_id in the
 * first place. Only shown for an unassigned day (spec §5's "no session to
 * point at" is a real, valid state on its own — this is the affordance for
 * moving out of it, not something forced on every empty day).
 */
export function AssignWorkoutPicker({
  workouts,
  onAssign,
}: {
  workouts: AssignableWorkout[];
  onAssign: (workoutId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (workouts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="assign-no-workouts">
        No saved workouts yet — create one in My Workouts.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="min-h-11 w-full">
        Assign a workout
      </Button>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5" data-testid="assign-workout-list">
      {workouts.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await onAssign(w.id);
                setOpen(false);
              })
            }
            className="min-h-11 w-full rounded-md border border-border/40 px-3 text-left text-sm hover:bg-muted"
          >
            {w.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
