"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Check } from "lucide-react";
import type { DailyLogItem } from "@/lib/fitness/daily-log";
import { repGoalProgress } from "@/lib/fitness/rep-goal";
import { SessionDetailPanel, type ConfirmSet, type SessionExercise } from "./session-detail-panel";
import { BenchmarkForm, type BenchmarkExercise } from "./benchmark-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const DAILY_CHECK_LABEL: Record<"protein" | "steps", string> = { protein: "Hit protein target", steps: "8,000+ steps" };
const BODY_METRIC_LABEL: Record<"weight" | "waist", string> = { weight: "Log today's weight", waist: "Log waist" };

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

// Matches TaskRowList's own checkbox exactly (2026-08-25 tap-to-complete
// redesign) — same "checked off green" affordance Ayman signed off on
// there, reused here rather than reinvented, since a daily-check row is the
// same interaction (one tap, done) just living on a different screen.
function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300",
        checked ? "border-accent-business bg-accent-business" : "border-border"
      )}
    >
      {checked && <Check className="size-3.5 text-white" strokeWidth={3} />}
    </span>
  );
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

  if (item.kind === "daily_check") {
    return <DailyCheckRow item={item} onToggle={props.onToggleDailyCheck} />;
  }

  if (item.kind === "body_metric") {
    return (
      <div data-testid={`daily-log-${itemKey(item)}`}>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="min-h-11 w-full rounded-lg border border-border/40 p-2 text-left text-sm"
        >
          {BODY_METRIC_LABEL[item.metric]}
          {item.lastValue !== null && <span className="ml-2 text-xs text-muted-foreground">last: {item.lastValue}</span>}
        </button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{BODY_METRIC_LABEL[item.metric]}</DialogTitle>
            </DialogHeader>
            <BodyMetricQuickEntry
              metric={item.metric}
              onLog={item.metric === "weight" ? props.onLogWeight : props.onLogWaist}
              onDone={() => setDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
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

// The zero-feedback bug (2026-08-25, Lead diagnosis): a daily_check tap
// used to fire the Server Action with NO client-side state change at all —
// nothing on screen moved until the server round-tripped and the row
// disappeared, 1-3s later. That silence read as a missed tap ("you have to
// tap it multiple times"), not a slow one. Fixed the same way TaskRowList's
// rows are: an optimistic, synchronous checkbox+strikethrough on the very
// click that fires the action, plus a pending guard so a second tap before
// the first settles can't double-fire the toggle (which would flip it back
// off).
function DailyCheckRow({
  item,
  onToggle,
}: {
  item: Extract<DailyLogItem, { kind: "daily_check" }>;
  onToggle: (kind: "protein" | "steps") => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useOptimistic(item.done, (_state, next: boolean) => next);

  function handleClick() {
    if (isPending || optimisticDone) return;
    startTransition(async () => {
      setOptimisticDone(true);
      await onToggle(item.checkKind);
    });
  }

  return (
    <button
      type="button"
      data-testid={`daily-log-${itemKey(item)}`}
      onClick={handleClick}
      disabled={isPending || optimisticDone}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border/40 p-2 text-left text-sm transition-colors disabled:cursor-default"
    >
      <Checkbox checked={optimisticDone} />
      <span className={cn("transition-colors duration-300", optimisticDone && "text-muted-foreground line-through")}>
        {DAILY_CHECK_LABEL[item.checkKind]}
      </span>
    </button>
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
    <div className="flex flex-col gap-2">
      <Input
        type="number"
        aria-label={metric === "weight" ? "Weight (lb)" : "Waist (in)"}
        value={value}
        onChange={(e) => setValue(e.target.value === "" ? "" : Number(e.target.value))}
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
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}
