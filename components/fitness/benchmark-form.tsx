"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type BenchmarkExercise = { exerciseId: string; name: string };

/**
 * Cycle Progress checks' benchmark form — weight, waist, max reps per
 * exercise (spec's confirmed decision). Shared between the Daily Log's
 * "benchmark" item (its tap behaviour, per the archetype table) and the
 * Cycle Progress checks module's own "Log cycle benchmarks" affordance —
 * same underlying logCycleBenchmark action either way, so there is nothing
 * to keep in sync between the two entry points.
 */
export function BenchmarkForm({
  exercises,
  onSubmit,
  onDone,
}: {
  exercises: BenchmarkExercise[];
  onSubmit: (weightLb: number | null, waistIn: number | null, reps: { exerciseId: string; maxReps: number }[]) => Promise<void>;
  onDone?: () => void;
}) {
  const [weight, setWeight] = useState<number | "">("");
  const [waist, setWaist] = useState<number | "">("");
  const [reps, setReps] = useState<Record<string, number | "">>({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      await onSubmit(
        weight === "" ? null : Number(weight),
        waist === "" ? null : Number(waist),
        exercises
          .filter((e) => reps[e.exerciseId] !== undefined && reps[e.exerciseId] !== "")
          .map((e) => ({ exerciseId: e.exerciseId, maxReps: Number(reps[e.exerciseId]) }))
      );
      onDone?.();
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="benchmark-form">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Weight (lb)
          <Input
            type="number"
            aria-label="Weight (lb)"
            className="w-20"
            value={weight}
            onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Waist (in)
          <Input
            type="number"
            aria-label="Waist (in)"
            className="w-20"
            value={waist}
            onChange={(e) => setWaist(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </label>
      </div>
      {exercises.map((e) => (
        <label key={e.exerciseId} className="flex items-center gap-2 text-xs text-muted-foreground">
          Max {e.name}
          <Input
            type="number"
            aria-label={`Max ${e.name}`}
            className="w-20"
            value={reps[e.exerciseId] ?? ""}
            onChange={(ev) =>
              setReps((prev) => ({ ...prev, [e.exerciseId]: ev.target.value === "" ? "" : Number(ev.target.value) }))
            }
          />
        </label>
      ))}
      <Button type="button" onClick={handleSubmit} disabled={isPending}>
        Save benchmark
      </Button>
    </div>
  );
}
