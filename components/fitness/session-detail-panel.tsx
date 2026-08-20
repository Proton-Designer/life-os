"use client";

import { useState, useTransition } from "react";
import { proposeNextLoad, type LastTopSet } from "@/lib/fitness/progression";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type SessionExercise = {
  exerciseId: string;
  name: string;
  targetSets: number;
  targetRepsLow: number;
  targetRepsHigh: number;
  targetLoad: number | null;
  lastTopSet: LastTopSet | null;
};

export type ConfirmSet = {
  exerciseId: string;
  exerciseName: string;
  position: number;
  sets: number;
  reps: number;
  load: number | null;
};

/**
 * The confirm interaction — spec §2.1's hard requirements. Every row's
 * actual numbers render inline and stay editable via a plain number-input
 * stepper (the same spinbutton pattern workout-builder already uses) BEFORE
 * the single Confirm button, never behind a tap-through. All exercises
 * render together, not one at a time, so there is nothing to auto-advance
 * through — reading every number is free, and adjusting one costs exactly
 * as much as confirming it, which is the whole honesty argument this UI
 * exists to protect (spec §2.1).
 */
export function SessionDetailPanel({
  date,
  dayLabel,
  workout,
  alreadyConfirmed,
  onConfirm,
}: {
  date: string;
  dayLabel: string;
  workout: { id: string; name: string; exercises: SessionExercise[] } | null;
  alreadyConfirmed: boolean;
  onConfirm: (date: string, workoutId: string, workoutName: string, sets: ConfirmSet[]) => Promise<void>;
}) {
  const [rows, setRows] = useState(() =>
    (workout?.exercises ?? []).map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name,
      sets: e.targetSets,
      reps: e.targetRepsHigh,
      load: proposeNextLoad(e.lastTopSet) ?? e.targetLoad,
    }))
  );
  const [isPending, startTransition] = useTransition();
  const [justConfirmed, setJustConfirmed] = useState(false);

  if (!workout) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="session-detail-empty">
        Nothing planned for {dayLabel}.
      </p>
    );
  }

  const confirmed = alreadyConfirmed || justConfirmed;

  function updateRow(exerciseId: string, patch: Partial<{ sets: number; reps: number; load: number | null }>) {
    setRows((prev) => prev.map((r) => (r.exerciseId === exerciseId ? { ...r, ...patch } : r)));
  }

  function handleConfirm() {
    if (!workout) return;
    const sets: ConfirmSet[] = rows.map((r, i) => ({
      exerciseId: r.exerciseId,
      exerciseName: r.name,
      position: i + 1,
      sets: r.sets,
      reps: r.reps,
      load: r.load,
    }));
    startTransition(async () => {
      await onConfirm(date, workout.id, workout.name, sets);
      setJustConfirmed(true);
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="session-detail-panel">
      <p className="text-sm font-medium">
        {workout.name} — {dayLabel}
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.exerciseId}
            data-testid={`session-row-${row.exerciseId}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 p-2"
          >
            <span className="min-w-0 flex-1 text-sm">{row.name}</span>
            <Input
              type="number"
              aria-label={`${row.name} sets`}
              className="w-14"
              value={row.sets}
              disabled={confirmed}
              onChange={(e) => updateRow(row.exerciseId, { sets: Number(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              type="number"
              aria-label={`${row.name} reps`}
              className="w-14"
              value={row.reps}
              disabled={confirmed}
              onChange={(e) => updateRow(row.exerciseId, { reps: Number(e.target.value) })}
            />
            {row.load !== null && (
              <>
                <span className="text-xs text-muted-foreground">@</span>
                <Input
                  type="number"
                  aria-label={`${row.name} load`}
                  className="w-16"
                  value={row.load}
                  disabled={confirmed}
                  onChange={(e) => updateRow(row.exerciseId, { load: Number(e.target.value) })}
                />
              </>
            )}
          </li>
        ))}
      </ul>

      {confirmed ? (
        <p className="text-sm text-muted-foreground" data-testid="session-confirmed-note">
          Confirmed for {dayLabel}.
        </p>
      ) : (
        <Button type="button" onClick={handleConfirm} disabled={isPending} className="w-full">
          Confirm {workout.name}
        </Button>
      )}
    </div>
  );
}
