"use client";

import { useEffect, useState, useTransition } from "react";
import { weeklyVolume, untaggedCount, type MuscleGroup } from "@/lib/fitness/volume";
import { ExercisePicker, type ExerciseOption } from "./exercise-picker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type BuilderRow = {
  key: string;
  exerciseId: string;
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  targetSets: number;
  targetRepsLow: number;
  targetRepsHigh: number;
  targetLoad: number | null;
};

export type ExerciseInput = {
  exerciseId: string;
  targetSets: number;
  targetRepsLow: number;
  targetRepsHigh: number;
  targetLoad: number | null;
};

export type BuilderWorkout = {
  id: string;
  name: string;
  exercises: BuilderRow[];
};

let rowKeySeq = 0;
function nextRowKey() {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

/**
 * Reorder (move up/move down, spec §3 Phase note) and all row edits live
 * entirely in local state — nothing is written to the database until Save,
 * which persists the whole ordered list atomically via `save_workout`
 * (029/031). That's what makes reorder safe against the
 * `unique(workout_id, position)` constraint without a temp-offset dance,
 * but it means an unsaved edit is real, lost work if he navigates away —
 * the beforeunload guard and the dirty-styled Save button below exist
 * specifically to surface that price rather than let him discover it
 * silently (Opus Lead review, 2026-08-20).
 */
export function WorkoutBuilder({
  workout,
  allExercises,
  onCreateExercise,
  onSaveNew,
  onSaveExisting,
  onDone,
}: {
  workout: BuilderWorkout | null;
  allExercises: ExerciseOption[];
  onCreateExercise: (
    name: string,
    primaryMuscles: MuscleGroup[],
    secondaryMuscles: MuscleGroup[]
  ) => Promise<{ id: string }>;
  onSaveNew: (name: string, exercises: ExerciseInput[]) => Promise<{ id: string }>;
  onSaveExisting: (workoutId: string, name: string, exercises: ExerciseInput[]) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(workout?.name ?? "");
  const [rows, setRows] = useState<BuilderRow[]>(workout?.exercises ?? []);
  const [dirty, setDirty] = useState(false);
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
  }

  function addExercise(exercise: ExerciseOption) {
    setRows((prev) => [
      ...prev,
      {
        key: nextRowKey(),
        exerciseId: exercise.id,
        name: exercise.name,
        primaryMuscles: exercise.primaryMuscles,
        secondaryMuscles: exercise.secondaryMuscles,
        targetSets: 3,
        targetRepsLow: 8,
        targetRepsHigh: 10,
        targetLoad: null,
      },
    ]);
    markDirty();
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    markDirty();
  }

  function moveRow(key: string, direction: -1 | 1) {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    markDirty();
  }

  function updateRow(key: string, patch: Partial<BuilderRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    markDirty();
  }

  function handleSave() {
    const exercises: ExerciseInput[] = rows.map((r) => ({
      exerciseId: r.exerciseId,
      targetSets: r.targetSets,
      targetRepsLow: r.targetRepsLow,
      targetRepsHigh: r.targetRepsHigh,
      targetLoad: r.targetLoad,
    }));
    startSaving(async () => {
      if (workout) {
        await onSaveExisting(workout.id, name, exercises);
      } else {
        await onSaveNew(name, exercises);
      }
      setDirty(false);
      onDone();
    });
  }

  const volume = weeklyVolume(
    rows.map((r) => ({ sets: r.targetSets, primaryMuscles: r.primaryMuscles, secondaryMuscles: r.secondaryMuscles }))
  );
  const untagged = untaggedCount(
    rows.map((r) => ({ sets: r.targetSets, primaryMuscles: r.primaryMuscles, secondaryMuscles: r.secondaryMuscles }))
  );
  const totalVolume = Object.values(volume).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="workout-builder">
      <Input
        placeholder="Workout name"
        aria-label="Workout name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          markDirty();
        }}
      />

      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li
            key={row.key}
            data-testid={`builder-row-${row.key}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 p-2"
          >
            <span className="min-w-0 flex-1 text-sm font-medium">{row.name}</span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Sets
              <Input
                type="number"
                aria-label={`${row.name} target sets`}
                className="w-14"
                value={row.targetSets}
                onChange={(e) => updateRow(row.key, { targetSets: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Reps
              <Input
                type="number"
                aria-label={`${row.name} target reps low`}
                className="w-14"
                value={row.targetRepsLow}
                onChange={(e) => updateRow(row.key, { targetRepsLow: Number(e.target.value) })}
              />
              –
              <Input
                type="number"
                aria-label={`${row.name} target reps high`}
                className="w-14"
                value={row.targetRepsHigh}
                onChange={(e) => updateRow(row.key, { targetRepsHigh: Number(e.target.value) })}
              />
            </label>
            <button
              type="button"
              aria-label={`Move ${row.name} up`}
              disabled={i === 0}
              onClick={() => moveRow(row.key, -1)}
              className="min-h-11 min-w-11 rounded-md border border-border/40 text-sm disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${row.name} down`}
              disabled={i === rows.length - 1}
              onClick={() => moveRow(row.key, 1)}
              className="min-h-11 min-w-11 rounded-md border border-border/40 text-sm disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove ${row.name}`}
              onClick={() => removeRow(row.key)}
              className="min-h-11 min-w-11 rounded-md border border-border/40 text-sm text-muted-foreground"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <ExercisePicker exercises={allExercises} onSelect={addExercise} onCreate={onCreateExercise} />

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="builder-volume">
          {totalVolume} weekly sets across {Object.values(volume).filter((v) => v > 0).length} muscle groups
          {untagged > 0 ? ` — ${untagged} exercise${untagged === 1 ? "" : "s"} aren't counted in your volume` : ""}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={isSaving || !name.trim()} data-dirty={dirty}>
        {dirty ? "Save*" : "Save"}
      </Button>
    </div>
  );
}
