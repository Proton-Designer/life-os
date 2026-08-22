"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { expandPlanToWeek } from "@/lib/fitness/plan-schedule";
import type { MicroExerciseDraft, PlanDraft } from "@/lib/fitness/plan-types";
import { ExercisePicker, type ExerciseOption } from "../exercise-picker";
import { WeekPreviewCalendar } from "./week-preview-calendar";
import { SchedulePicker } from "./schedule-picker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MuscleGroup } from "@/lib/fitness/volume";

let rowSeq = 0;
function tempId() {
  rowSeq += 1;
  return `micro-tmp-${rowSeq}`;
}

/**
 * Micro workout builder — one row per exercise: name (via ExercisePicker),
 * schedule, goal (daily total reps, or frequency bouts), optional notes.
 * The live week preview below is expandPlanToWeek(draft) called directly on
 * this in-progress, unsaved state (plan-authoring type contract's
 * integration seam) — no save round-trip to see it update.
 */
export function MicroBuilder({
  initialName,
  initialExercises,
  planId,
  allExercises,
  onCreateExercise,
  onSave,
  onDone,
}: {
  initialName: string;
  initialExercises: MicroExerciseDraft[];
  planId: string | null;
  allExercises: ExerciseOption[];
  onCreateExercise: (
    name: string,
    primaryMuscles: MuscleGroup[],
    secondaryMuscles: MuscleGroup[]
  ) => Promise<{ id: string }>;
  onSave: (draft: PlanDraft) => Promise<{ id: string }>;
  onDone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [exercises, setExercises] = useState<MicroExerciseDraft[]>(initialExercises);
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
    setExercises((prev) => [
      ...prev,
      {
        id: null,
        exerciseId: exercise.id,
        name: exercise.name,
        scheduleDays: [1, 2, 3, 4, 5],
        goalType: "daily_total",
        goalValue: 10,
        notes: null,
      },
    ]);
    markDirty();
  }

  function updateExercise(index: number, patch: Partial<MicroExerciseDraft>) {
    setExercises((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    markDirty();
  }

  function removeExercise(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  }

  const draft: PlanDraft = useMemo(
    () => ({ kind: "micro", id: planId, name, exercises }),
    [planId, name, exercises]
  );
  const preview = useMemo(() => expandPlanToWeek(draft), [draft]);

  function handleSave() {
    startSaving(async () => {
      await onSave(draft);
      setDirty(false);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="micro-builder">
      <Input
        placeholder="Workout name"
        aria-label="Workout name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          markDirty();
        }}
      />

      <ul className="flex flex-col gap-3">
        {exercises.map((exercise, i) => (
          <li
            key={exercise.id ?? `${exercise.exerciseId}-${i}`}
            data-testid={`micro-row-${i}`}
            className="flex flex-col gap-2 rounded-lg border border-border/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{exercise.name}</span>
              <button
                type="button"
                aria-label={`Remove ${exercise.name}`}
                onClick={() => removeExercise(i)}
                className="min-h-11 min-w-11 rounded-md border border-border/40 text-sm text-muted-foreground"
              >
                ✕
              </button>
            </div>
            <SchedulePicker
              label="Schedule"
              value={exercise.scheduleDays}
              onChange={(days) => updateExercise(i, { scheduleDays: days })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Goal
                <select
                  aria-label={`${exercise.name} goal type`}
                  value={exercise.goalType}
                  onChange={(e) => updateExercise(i, { goalType: e.target.value as MicroExerciseDraft["goalType"] })}
                  className="min-h-11 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="daily_total">Daily total</option>
                  <option value="frequency">Frequency</option>
                </select>
              </label>
              <Input
                type="number"
                aria-label={`${exercise.name} goal value`}
                className="w-20"
                value={exercise.goalValue}
                onChange={(e) => updateExercise(i, { goalValue: Number(e.target.value) })}
              />
              <span className="text-xs text-muted-foreground">
                {exercise.goalType === "daily_total" ? "reps/day" : "bouts/day"}
              </span>
            </div>
            <Input
              placeholder="Notes (optional)"
              aria-label={`${exercise.name} notes`}
              value={exercise.notes ?? ""}
              onChange={(e) => updateExercise(i, { notes: e.target.value || null })}
            />
          </li>
        ))}
      </ul>

      <ExercisePicker exercises={allExercises} onSelect={addExercise} onCreate={onCreateExercise} />

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Week preview</p>
        <WeekPreviewCalendar preview={preview} />
      </div>

      <Button
        type="button"
        onClick={handleSave}
        disabled={isSaving || !name.trim() || exercises.length === 0}
        data-dirty={dirty}
      >
        {dirty ? "Save*" : "Save"}
      </Button>
    </div>
  );
}
