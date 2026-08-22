"use client";

import { useState, useTransition } from "react";
import type { DailyLogItem } from "@/lib/fitness/daily-log";
import { repGoalProgress } from "@/lib/fitness/rep-goal";
import { SessionDetailPanel, type ConfirmSet, type SessionExercise } from "./session-detail-panel";
import { BenchmarkForm, type BenchmarkExercise } from "./benchmark-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DAILY_CHECK_LABEL: Record<"protein" | "steps", string> = { protein: "Hit protein target", steps: "8,000+ steps" };
const BODY_METRIC_LABEL: Record<"weight" | "waist", string> = { weight: "Log today's weight", waist: "Log waist" };

/**
 * The Daily Log module's list — every archetype's tap behaviour from the
 * plan's own table, in one place. Each row is its own tiny state machine
 * (collapsed -> tap -> inline action), never a navigation away from the
 * list; a row disappears the next time the server round-trips (revalidate)
 * once its target's been met — "once that fills that's when the log goes
 * away" (Ayman) is enforced by pendingDailyLog on the SERVER side, this
 * component just renders whatever list it's handed.
 */
export function DailyLogList({
  date,
  items,
  sessionDetailsBySessionId,
  benchmarkExercises,
  onLogReps,
  onConfirmSession,
  onToggleDailyCheck,
  onLogWeight,
  onLogWaist,
  onLogBenchmark,
}: {
  /** The local date this log is for — forwarded to SessionDetailPanel's confirm call, never read from a client Date(). */
  date: string;
  items: DailyLogItem[];
  sessionDetailsBySessionId: Record<string, { exercises: SessionExercise[] }>;
  benchmarkExercises: BenchmarkExercise[];
  onLogReps: (exerciseId: string, exerciseName: string, reps: number) => Promise<void>;
  onConfirmSession: (date: string, sessionId: string, sessionName: string, sets: ConfirmSet[]) => Promise<void>;
  onToggleDailyCheck: (kind: "protein" | "steps") => Promise<void>;
  onLogWeight: (value: number) => Promise<void>;
  onLogWaist: (value: number) => Promise<void>;
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
            onToggleDailyCheck={onToggleDailyCheck}
            onLogWeight={onLogWeight}
            onLogWaist={onLogWaist}
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
  if (item.kind === "daily_check") return `check-${item.checkKind}`;
  if (item.kind === "body_metric") return `metric-${item.metric}`;
  return "benchmark";
}

function DailyLogRow(props: {
  date: string;
  item: DailyLogItem;
  sessionDetailsBySessionId: Record<string, { exercises: SessionExercise[] }>;
  benchmarkExercises: BenchmarkExercise[];
  onLogReps: (exerciseId: string, exerciseName: string, reps: number) => Promise<void>;
  onConfirmSession: (date: string, sessionId: string, sessionName: string, sets: ConfirmSet[]) => Promise<void>;
  onToggleDailyCheck: (kind: "protein" | "steps") => Promise<void>;
  onLogWeight: (value: number) => Promise<void>;
  onLogWaist: (value: number) => Promise<void>;
  onLogBenchmark: (weightLb: number | null, waistIn: number | null, reps: { exerciseId: string; maxReps: number }[]) => Promise<void>;
}) {
  const { item } = props;
  const [expanded, setExpanded] = useState(false);

  if (item.kind === "micro_total" || item.kind === "micro_freq") {
    const done = item.kind === "micro_total" ? item.logged : item.bouts;
    const progress = repGoalProgress(done, item.target);
    return (
      <div className="flex flex-col gap-1.5" data-testid={`daily-log-${itemKey(item)}`}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
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
        {expanded && <RepsQuickEntry exerciseId={item.exerciseId} exerciseName={item.name} onLog={props.onLogReps} onDone={() => setExpanded(false)} />}
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

  if (item.kind === "daily_check") {
    return (
      <button
        type="button"
        data-testid={`daily-log-${itemKey(item)}`}
        onClick={() => props.onToggleDailyCheck(item.checkKind)}
        className={cn("min-h-11 w-full rounded-lg border border-border/40 p-2 text-left text-sm", item.done && "opacity-60")}
      >
        {DAILY_CHECK_LABEL[item.checkKind]}
      </button>
    );
  }

  if (item.kind === "body_metric") {
    return (
      <div className="flex flex-col gap-1.5" data-testid={`daily-log-${itemKey(item)}`}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-h-11 w-full rounded-lg border border-border/40 p-2 text-left text-sm"
        >
          {BODY_METRIC_LABEL[item.metric]}
          {item.lastValue !== null && <span className="ml-2 text-xs text-muted-foreground">last: {item.lastValue}</span>}
        </button>
        {expanded && (
          <BodyMetricQuickEntry
            metric={item.metric}
            onLog={item.metric === "weight" ? props.onLogWeight : props.onLogWaist}
            onDone={() => setExpanded(false)}
          />
        )}
      </div>
    );
  }

  // benchmark
  return (
    <div className="flex flex-col gap-1.5" data-testid={`daily-log-${itemKey(item)}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="min-h-11 w-full rounded-lg border border-accent-fitness/40 bg-accent-fitness/5 p-2 text-left text-sm font-medium"
      >
        Cycle {item.cycleNumber} benchmark due — log by {item.dueBy}
      </button>
      {expanded && (
        <BenchmarkForm exercises={props.benchmarkExercises} onSubmit={props.onLogBenchmark} onDone={() => setExpanded(false)} />
      )}
    </div>
  );
}

function RepsQuickEntry({
  exerciseId,
  exerciseName,
  onLog,
  onDone,
}: {
  exerciseId: string;
  exerciseName: string;
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
    <div className="flex items-center gap-2">
      <Input type="number" aria-label={`${exerciseName} reps this bout`} className="w-16" value={reps} onChange={(e) => setReps(Number(e.target.value))} />
      <Button type="button" onClick={handleLog} disabled={isPending}>
        Log
      </Button>
    </div>
  );
}

function BodyMetricQuickEntry({
  metric,
  onLog,
  onDone,
}: {
  metric: "weight" | "waist";
  onLog: (value: number) => Promise<void>;
  onDone: () => void;
}) {
  const [value, setValue] = useState<number | "">("");
  const [isPending, startTransition] = useTransition();
  function handleLog() {
    if (value === "") return;
    startTransition(async () => {
      await onLog(Number(value));
      onDone();
    });
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        aria-label={metric === "weight" ? "Weight (lb)" : "Waist (in)"}
        className="w-20"
        value={value}
        onChange={(e) => setValue(e.target.value === "" ? "" : Number(e.target.value))}
      />
      <Button type="button" onClick={handleLog} disabled={isPending}>
        Save
      </Button>
    </div>
  );
}
