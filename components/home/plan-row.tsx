"use client";

import { Check, Loader2, Pause, Play } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { RowShell } from "@/components/shared/row-shell";
import { formatHHMM12 } from "@/lib/date-utils";
import type { PlanItem } from "@/lib/plan/get-plan-items";
import { planAreaChip } from "@/lib/plan/plan-area-chip";
import { PLAN_AREA_LABEL, formatClockSeconds, formatDuration, startBehavior, timerReadout, type PlanTimerState } from "@/lib/plan/plan-behavior";
import { cn } from "@/lib/utils";

/**
 * One of today's plan lines in Home's Today list: the area's icon chip (so plan rows and priority rows read as one list),
 * the task and its meta, and the actions that fit its STATE on the right (lib/plan/plan-behavior.ts has the rules):
 *
 *   idle, startable      [Start] then a subtle "Mark Done" (text style: finishing a task you never started is secondary)
 *   idle, nothing to run [Mark Done] (outline), as always
 *   running inline       the readout, [Pause] and [Mark Done]
 *   running session      "In session · 12:04" (tap opens the Deep Session), [Pause] and [Mark Done]
 *   paused               "Paused · 12:04 left" / "Paused · 23:10", [Resume] and a subtle "Mark Done"
 *
 * Presentational: the unified list owns the writes (components/home/use-plan-actions.ts) and the leave-cleanly bookkeeping
 * (components/shared/use-row-overlay.ts). A Mark Done tap strikes the title at once; the row then leaves like every other row.
 * Layout: the actions sit right-aligned beside the title and WRAP onto a second line under it when the title would get fewer
 * than ~120px (a phone), rather than squeezing it.
 */
export function PlanRow({
  item,
  state,
  nowMs,
  sessionStartedAtMs,
  busy,
  message,
  struck,
  exiting,
  emphasis,
  onComplete,
  onStart,
  onPause,
  onOpenSession,
}: {
  item: PlanItem;
  state: PlanTimerState;
  nowMs: number;
  /** When `state` is running-session: the instant that session started (the readout adds the seconds already banked). */
  sessionStartedAtMs: number | null;
  busy: boolean;
  message: string | undefined;
  /** The tap has been made; the row is struck while it waits out the confirmation beat. */
  struck: boolean;
  exiting: boolean;
  emphasis?: "focus" | "dim";
  onComplete: () => void;
  /** Start, and Resume from a pause: the same call. */
  onStart: () => void;
  onPause: () => void;
  onOpenSession: () => void;
}) {
  const behavior = startBehavior(item.area, { startTime: item.startTime, durationMinutes: item.durationMinutes });
  const chip = planAreaChip(item.area);
  const meta = [item.area ? PLAN_AREA_LABEL[item.area] : null, item.startTime ? formatHHMM12(item.startTime) : null, item.durationMinutes !== null ? formatDuration(item.durationMinutes) : null].filter((m): m is string => m !== null);
  const done = struck || exiting;

  const startedMs = state === "running-inline" && item.timerStartedAt ? new Date(item.timerStartedAt).getTime() : state === "running-session" ? sessionStartedAtMs : null;
  const readout = state === "idle" ? null : timerReadout(startedMs, item.durationMinutes, nowMs, item.timerElapsedSeconds);
  const runningText = readout ? (readout.done ? "Time's up" : `${readout.mode === "up" ? "" : "−"}${formatClockSeconds(readout.seconds)}`) : null;
  const pausedText = readout ? `Paused · ${readout.done ? "Time's up" : readout.mode === "up" ? formatClockSeconds(readout.seconds) : `${formatClockSeconds(readout.seconds)} left`}` : null;

  const subtleDone = (
    <button
      type="button"
      onClick={onComplete}
      disabled={done}
      aria-label={`Mark ${item.title} done`}
      className="inline-flex h-8 shrink-0 items-center rounded-md px-2 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
    >
      Mark Done
    </button>
  );
  const primaryDone = (
    <button type="button" onClick={onComplete} disabled={done} aria-label={`Complete ${item.title}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-60">
      <Check className="size-3.5" aria-hidden />
      Mark Done
    </button>
  );
  const pauseButton = (
    <button type="button" onClick={onPause} disabled={done || busy} aria-label={`Pause ${item.title}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60">
      <Pause className="size-3.5" aria-hidden />
      Pause
    </button>
  );

  return (
    <RowShell exiting={exiting} emphasis={emphasis} data-testid="plan-row">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2">
        {/* The same width as the priority rows' checkbox column, so both kinds of row put their chip and title at the same x
            (a plan line has no checkbox: its completion is the Mark Done button). */}
        <span aria-hidden className="size-5 shrink-0" data-testid="plan-row-spacer" />
        <IconChip icon={chip.icon} accent={chip.accent} size="sm" data-dim />
        <div className="min-w-0 grow basis-[7.5rem]">
          <p data-dim className={cn("truncate text-sm transition-colors duration-300", done && "text-muted-foreground line-through decoration-accent-business")}>
            {item.mitRank === 1 ? <span aria-label="crowned" className="mr-1.5">★</span> : null}
            {item.title}
          </p>
          {meta.length > 0 ? (
            <p data-dim className="truncate text-xs text-muted-foreground">
              {meta.join(" · ")}
            </p>
          ) : null}
          {message ? (
            <p role="alert" className="text-xs text-destructive">
              {message}
            </p>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {state === "running-inline" ? (
            <>
              <span data-testid="plan-timer" aria-live="off" className={cn("shrink-0 font-mono text-sm tabular-nums", readout?.done && "text-primary")}>
                {runningText}
              </span>
              {pauseButton}
              {primaryDone}
            </>
          ) : state === "running-session" ? (
            <>
              <button type="button" onClick={onOpenSession} data-testid="plan-session-readout" aria-label={`Open the session for ${item.title}`} className={cn("shrink-0 font-mono text-sm tabular-nums underline-offset-4 hover:underline", readout?.done && "text-primary")}>
                In session · {runningText}
              </button>
              {pauseButton}
              {primaryDone}
            </>
          ) : state === "paused" ? (
            <>
              <span data-testid="plan-timer" aria-live="off" className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                {pausedText}
              </span>
              <button type="button" onClick={onStart} disabled={busy || done} aria-label={`Resume ${item.title}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                {busy ? "Resuming" : "Resume"}
              </button>
              {subtleDone}
            </>
          ) : behavior.kind === "complete_only" ? (
            <button type="button" onClick={onComplete} disabled={done} aria-label={`Mark ${item.title} done`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60">
              <Check className="size-3.5" aria-hidden />
              Mark Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onStart} disabled={busy || done} aria-label={`Start ${item.title}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                {busy ? "Starting" : "Start"}
              </button>
              {subtleDone}
            </>
          )}
        </div>
      </div>
    </RowShell>
  );
}
