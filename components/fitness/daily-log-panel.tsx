"use client";

import { DailyLogList } from "./daily-log-list";
import type { DailyLogItem } from "@/lib/fitness/daily-log";
import type { ConfirmSet, SessionExercise } from "./session-detail-panel";
import type { BenchmarkExercise } from "./benchmark-form";

/**
 * The RSC-boundary adapter for Daily Log (same reasoning as
 * fitness-log-panel.tsx): page.tsx only ever hands this bound Server
 * Action references (quickLogExercise.bind(null, dateStr), etc, never a
 * wrapping arrow — AGENTS.md). quickLogExercise's real signature is
 * (exerciseId, exerciseName, sets, reps, load) once date is bound, but
 * DailyLogList's onLogReps wants (exerciseId, exerciseName, reps) — a
 * micro exercise's quick-add is always a single bare bout (sets: 1, load:
 * null), same convention RepGoalBars already uses on Home/the interim Log
 * panel. That shape adaptation happens HERE, client-side, not in page.tsx.
 */
export function DailyLogPanel({
  date,
  items,
  sessionDetailsBySessionId,
  benchmarkExercises,
  onLogExercise,
  onConfirmSession,
  onLogBenchmark,
}: {
  date: string;
  items: DailyLogItem[];
  sessionDetailsBySessionId: Record<string, { exercises: SessionExercise[] }>;
  benchmarkExercises: BenchmarkExercise[];
  onLogExercise: (exerciseId: string, exerciseName: string, sets: number, reps: number, load: number | null) => Promise<void>;
  onConfirmSession: (date: string, sessionId: string, sessionName: string, sets: ConfirmSet[]) => Promise<void>;
  onLogBenchmark: (weightLb: number | null, waistIn: number | null, reps: { exerciseId: string; maxReps: number }[]) => Promise<void>;
}) {
  return (
    <DailyLogList
      date={date}
      items={items}
      sessionDetailsBySessionId={sessionDetailsBySessionId}
      benchmarkExercises={benchmarkExercises}
      onLogReps={(exerciseId, exerciseName, reps) => onLogExercise(exerciseId, exerciseName, 1, reps, null)}
      onConfirmSession={onConfirmSession}
      onLogBenchmark={onLogBenchmark}
    />
  );
}
