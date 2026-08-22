"use client";

import { useState } from "react";
import { BodyModule } from "./body-module";
import { BenchmarkForm, type BenchmarkExercise } from "./benchmark-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BenchmarkDelta = { exerciseId: string; name: string; current: number | null; previous: number | null };

/**
 * Cycle Progress checks — absorbs the old Body panel, adds cycle framing
 * (spec: "current stats for weight, waist, exercise goals if applicable,
 * then the ability to long benchmark cycle progress" — read as "log," the
 * spec's own typo). "Log cycle benchmarks" reuses the same BenchmarkForm
 * as the Daily Log's benchmark item — one action, two entry points.
 */
export function CycleProgressPanel({
  cycleNumber,
  daysLeft,
  weightAvg7d,
  waist,
  deltas,
  benchmarkExercises,
  onLogBenchmark,
}: {
  cycleNumber: number;
  daysLeft: number;
  weightAvg7d: number | null;
  waist: { valueIn: number; date: string } | null;
  deltas: BenchmarkDelta[];
  benchmarkExercises: BenchmarkExercise[];
  onLogBenchmark: (weightLb: number | null, waistIn: number | null, reps: { exerciseId: string; maxReps: number }[]) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="flex flex-col gap-3" data-testid="cycle-progress-panel">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Cycle {cycleNumber}</span>
        <span className="text-xs text-muted-foreground">{daysLeft}d left</span>
      </div>
      <BodyModule weightAvg7d={weightAvg7d} waist={waist} />
      {deltas.length > 0 && (
        <ul className="flex flex-col gap-1">
          {deltas.map((d) => (
            <li key={d.exerciseId} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{d.name}</span>
              <span className="tabular-nums">
                {d.current ?? "—"}
                {d.previous !== null && d.current !== null && (
                  <span className={cn(d.current - d.previous >= 0 ? "text-accent-fitness" : "text-destructive")}>
                    {" "}
                    ({d.current - d.previous >= 0 ? "+" : ""}
                    {d.current - d.previous})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!showForm ? (
        <Button type="button" variant="outline" onClick={() => setShowForm(true)}>
          Log cycle benchmarks
        </Button>
      ) : (
        <BenchmarkForm exercises={benchmarkExercises} onSubmit={onLogBenchmark} onDone={() => setShowForm(false)} />
      )}
    </div>
  );
}
