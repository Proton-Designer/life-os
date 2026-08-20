"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExercisePicker, type ExerciseOption } from "./exercise-picker";
import type { MuscleGroup } from "@/lib/fitness/volume";

/**
 * The general "log anything, anytime" affordance (spec §4 quick-add) —
 * reachable from Home, not only Fitness, since odd-moment training happens
 * "between other things." Logs a bare single-exercise session; scattered
 * same-day entries stay separate rows, never merged into one — this
 * component never asks "which session am I adding to."
 */
export function QuickAddSheet({
  exercises,
  onCreateExercise,
  onLog,
}: {
  exercises: ExerciseOption[];
  onCreateExercise: (
    name: string,
    primaryMuscles: MuscleGroup[],
    secondaryMuscles: MuscleGroup[]
  ) => Promise<{ id: string }>;
  onLog: (exerciseId: string, exerciseName: string, sets: number, reps: number, load: number | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ExerciseOption | null>(null);
  const [sets, setSets] = useState(1);
  const [reps, setReps] = useState(10);
  const [load, setLoad] = useState<number | "">("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setSelected(null);
    setSets(1);
    setReps(10);
    setLoad("");
  }

  function handleLog() {
    if (!selected) return;
    startTransition(async () => {
      await onLog(selected.id, selected.name, sets, reps, load === "" ? null : Number(load));
      reset();
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11">
          + Quick log
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick log</DialogTitle>
        </DialogHeader>
        {!selected ? (
          <ExercisePicker exercises={exercises} onSelect={setSelected} onCreate={onCreateExercise} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{selected.name}</p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Sets
                <Input
                  type="number"
                  aria-label="Sets"
                  className="w-14"
                  value={sets}
                  onChange={(e) => setSets(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Reps
                <Input
                  type="number"
                  aria-label="Reps"
                  className="w-14"
                  value={reps}
                  onChange={(e) => setReps(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Load (optional)
                <Input
                  type="number"
                  aria-label="Load"
                  className="w-16"
                  value={load}
                  onChange={(e) => setLoad(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </label>
            </div>
            <Button type="button" onClick={handleLog} disabled={isPending}>
              Log it
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
