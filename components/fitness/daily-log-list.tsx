"use client";

import { useState, useTransition } from "react";
import type { DailyLogItem } from "@/lib/fitness/daily-log";
import { repGoalProgress } from "@/lib/fitness/rep-goal";
import { SessionDetailPanel, type ConfirmSet, type SessionExercise } from "./session-detail-panel";
import { BenchmarkForm, type BenchmarkExercise } from "./benchmark-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The Daily Log module's list — every archetype's tap behaviour from the
 * plan's own table, in one place. Each row is its own tiny state machine.
 * Every archetype except "session" opens a POPUP (Dialog) the instant it's
 * tapped — Ayman, 2026-08-25: "change it so that it opens a popup right
 * away and lets you log a count in the popup and save that," replacing the
 * old inline-expansion-below-the-row behaviour. `session` is the deliberate
 * exception (see DailyLogRow's session branch) — SessionDetailPanel is a
 * multi-exercise sets/reps/load editor with a single Confirm, not a "log a
 * count" affordance, and stuffing it into a modal would be a regression.
 * A row disappears the next time the server round-trips (revalidate) once
 * its target's been met — "once that fills that's when the log goes away"
 * (Ayman) is enforced by pendingDailyLog on the SERVER side, this component
 * just renders whatever list it's handed.
 *
 * `daily_check` (protein/steps) and `body_metric` (weight/waist) rows are
 * GONE from this list as of 2026-08-25/26 batch 2, item 3 — Ayman: "dont
 * turn them into daily tasks, just keep them there, when i want to do it I
 * will." Weight/waist logging moved to CycleProgressPanel (still available,
 * just not a daily task); protein/steps have no surviving UI at all.
 */
export function DailyLogList({
  date,
  items,
  sessionDetailsBySessionId,
  benchmarkExercises,
  onLogReps,
  onConfirmSession,
  onLogBenchmark,
}: {
  /** The local date this log is for — forwarded to SessionDetailPanel's confirm call, never read from a client Date(). */
  date: string;
  items: DailyLogItem[];
  sessionDetailsBySessionId: Record<string, { exercises: SessionExercise[] }>;
  benchmarkExercises: BenchmarkExercise[];
  onLogReps: (exerciseId: string, exerciseName: string, reps: number) => Promise<void>;
  onConfirmSession: (date: string, sessionId: string, sessionName: string, sets: ConfirmSet[]) => Promise<void>;
  onLogBenchmark: (weightLb: number | null, waistIn: number | null, reps: { exerciseId: string; maxReps: number }[]) => Promise<void>;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing left to log today.</p>;
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="daily-log-list">
      {items.map((item) => (
        <li key={itemKey(item)}>
          <DailyLogRow
            date={date}
            item={item}
            sessionDetailsBySessionId={sessionDetailsBySessionId}
            benchmarkExercises={benchmarkExercises}
            onLogReps={onLogReps}
            onConfirmSession={onConfirmSession}
            onLogBenchmark={onLogBenchmark}
          />
        </li>
      ))}
    </ul>
  );
}

function itemKey(item: DailyLogItem): string {
  if (item.kind === "micro_total" || item.kind === "micro_freq") return `${item.kind}-${item.exerciseId}`;
  if (item.kind === "session") return `session-${item.sessionId}`;
  return "benchmark";
}

function DailyLogRow(props: {
  date: string;
  item: DailyLogItem;
  sessionDetailsBySessionId: Record<string, { exercises: SessionExercise[] }>;
  benchmarkExercises: BenchmarkExercise[];
  onLogReps: (exerciseId: string, exerciseName: string, reps: number) => Promise<void>;
  onConfirmSession: (date: string, sessionId: string, sessionName: string, sets: ConfirmSet[]) => Promise<void>;
  onLogBenchmark: (weightLb: number | null, waistIn: number | null, reps: { exerciseId: string; maxReps: number }[]) => Promise<void>;
}) {
  const { item } = props;
  // Only "session" still uses an inline expansion — every other archetype
  // opens a Dialog instead (see the file-level comment for why session is
  // the deliberate exception).
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (item.kind === "micro_total" || item.kind === "micro_freq") {
    const done = item.kind === "micro_total" ? item.logged : item.bouts;
    const progress = repGoalProgress(done, item.target);
    return (
      <div data-testid={`daily-log-${itemKey(item)}`}>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="min-h-11 w-full rounded-lg border border-border/40 p-2 text-left"
        >
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{item.name}</span>
            <span className="tabular-nums text-muted-foreground">
              {progress.done}/{progress.target}
              {item.kind === "micro_freq" ? "x" : ""}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-accent-fitness transition-all" style={{ width: `${progress.fraction * 100}%` }} />
          </div>
        </button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{item.name}</DialogTitle>
            </DialogHeader>
            <RepsQuickEntry
              exerciseId={item.exerciseId}
              exerciseName={item.name}
              progressLabel={`${progress.done}/${progress.target}${item.kind === "micro_freq" ? "x" : ""} so far`}
              onLog={props.onLogReps}
              onDone={() => setDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (item.kind === "session") {
    const detail = props.sessionDetailsBySessionId[item.sessionId];
    return (
      <div className="flex flex-col gap-1.5" data-testid={`daily-log-${itemKey(item)}`}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-h-11 w-full rounded-lg border border-border/40 p-2 text-left"
        >
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">
              {item.startTime ?? "Unscheduled"} · {item.durationMinutes}m
            </span>
          </div>
        </button>
        {expanded && detail && (
          <SessionDetailPanel
            date={props.date}
            dayLabel="today"
            workout={{ id: item.sessionId, name: item.name, exercises: detail.exercises }}
            alreadyConfirmed={item.confirmed}
            onConfirm={props.onConfirmSession}
          />
        )}
      </div>
    );
  }

  // benchmark
  return (
    <div data-testid={`daily-log-${itemKey(item)}`}>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="min-h-11 w-full rounded-lg border border-accent-fitness/40 bg-accent-fitness/5 p-2 text-left text-sm font-medium"
      >
        Cycle {item.cycleNumber} benchmark due — log by {item.dueBy}
      </button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cycle {item.cycleNumber} benchmark</DialogTitle>
          </DialogHeader>
          <BenchmarkForm exercises={props.benchmarkExercises} onSubmit={props.onLogBenchmark} onDone={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RepsQuickEntry({
  exerciseId,
  exerciseName,
  progressLabel,
  onLog,
  onDone,
}: {
  exerciseId: string;
  exerciseName: string;
  progressLabel: string;
  onLog: (exerciseId: string, exerciseName: string, reps: number) => Promise<void>;
  onDone: () => void;
}) {
  const [reps, setReps] = useState(1);
  const [isPending, startTransition] = useTransition();
  function handleLog() {
    startTransition(async () => {
      await onLog(exerciseId, exerciseName, reps);
      onDone();
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{progressLabel}</p>
      <Input
        type="number"
        aria-label={`${exerciseName} reps this bout`}
        value={reps}
        onChange={(e) => setReps(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleLog();
          }
        }}
        autoFocus
      />
      <DialogFooter>
        <Button type="button" onClick={handleLog} disabled={isPending}>
          Log
        </Button>
      </DialogFooter>
    </div>
  );
}
