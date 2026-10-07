"use client";

import { Check, Loader2, Play, Square } from "lucide-react";
import { RowShell } from "@/components/shared/row-shell";
import { formatHHMM12 } from "@/lib/date-utils";
import type { PlanItem } from "@/lib/plan/get-plan-items";
import { PLAN_AREA_LABEL, formatClockSeconds, formatDuration, startBehavior, timerReadout } from "@/lib/plan/plan-behavior";
import { cn } from "@/lib/utils";

/**
 * One of today's plan lines in Home's Today list: the task, its meta, and the ONE action that fits it on the right
 * (lib/plan/plan-behavior.ts is the rule):
 *   Start      Business -> Deep Work, School -> Deep Study (a session), anything else with a start time or timer
 *              -> a timer / elapsed count right here on the row
 *   Mark Done  a task with no start time and no timer: one tap checks it off
 *   Done       once an inline timer is running: the readout, Done, and a small stop
 * Presentational: the unified list owns the writes (components/home/use-plan-actions.ts) and the leave-cleanly bookkeeping
 * (components/shared/use-row-overlay.ts). A tap strikes the title at once; the row then leaves like every other row.
 */
export function PlanRow({
  item,
  nowMs,
  busy,
  message,
  struck,
  exiting,
  emphasis,
  onComplete,
  onStart,
  onStop,
}: {
  item: PlanItem;
  nowMs: number;
  busy: boolean;
  message: string | undefined;
  /** The tap has been made; the row is struck while it waits out the confirmation beat. */
  struck: boolean;
  exiting: boolean;
  emphasis?: "focus" | "dim";
  onComplete: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const behavior = startBehavior(item.area, { startTime: item.startTime, durationMinutes: item.durationMinutes });
  const running = item.timerStartedAt !== null;
  const readout = running ? timerReadout(new Date(item.timerStartedAt!).getTime(), item.durationMinutes, nowMs) : null;
  const meta = [item.area ? PLAN_AREA_LABEL[item.area] : null, item.startTime ? formatHHMM12(item.startTime) : null, item.durationMinutes !== null ? formatDuration(item.durationMinutes) : null].filter((m): m is string => m !== null);
  const done = struck || exiting;

  return (
    <RowShell exiting={exiting} emphasis={emphasis} data-testid="plan-row">
      <div className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm transition-colors duration-300", done && "text-muted-foreground line-through decoration-accent-business")}>
            {item.mitRank === 1 ? <span aria-label="crowned" className="mr-1.5">★</span> : null}
            {item.title}
          </p>
          {meta.length > 0 ? <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p> : null}
          {message ? (
            <p role="alert" className="text-xs text-destructive">
              {message}
            </p>
          ) : null}
        </div>

        {running && readout ? (
          <>
            <span data-testid="plan-timer" aria-live="off" className={cn("shrink-0 font-mono text-sm tabular-nums", readout.done && "text-primary")}>
              {readout.done ? "Time's up" : `${readout.mode === "up" ? "" : "−"}${formatClockSeconds(readout.seconds)}`}
            </span>
            <button type="button" onClick={onStop} disabled={done} aria-label={`Stop timer for ${item.title}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Square className="size-3.5" aria-hidden />
            </button>
            <button type="button" onClick={onComplete} disabled={done} aria-label={`Complete ${item.title}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-60">
              <Check className="size-3.5" aria-hidden />
              Done
            </button>
          </>
        ) : behavior.kind === "complete_only" ? (
          <button type="button" onClick={onComplete} disabled={done} aria-label={`Mark ${item.title} done`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60">
            <Check className="size-3.5" aria-hidden />
            Mark Done
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={busy || done}
            aria-label={`Start ${item.title}`}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {busy ? "Starting" : "Start"}
          </button>
        )}
      </div>
    </RowShell>
  );
}
