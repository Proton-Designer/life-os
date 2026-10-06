"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Play, Square } from "lucide-react";
import { setPlanItemCompleted, startPlanItem, stopPlanItemTimer } from "@/app/(app)/open/today/plan-item-actions";
import { refreshBusinessViews } from "@/app/(app)/business/actions";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";
import { useHomeRefresh } from "@/components/home/use-home-refresh";
import { formatHHMM12 } from "@/lib/date-utils";
import type { PlanItem } from "@/lib/plan/get-plan-items";
import { PLAN_AREA_LABEL, formatClockSeconds, formatDuration, startBehavior, timerReadout } from "@/lib/plan/plan-behavior";
import { cn } from "@/lib/utils";

/**
 * Today's plan inside Home's Now panel: every task the person committed to last night (or edited since), in order --
 * timed tasks by clock time, the rest in the order they set -- each with the ONE action that fits it, on the right:
 *
 *   Start      Business -> Deep Work, School -> Deep Study (a session), anything else with a start time or timer
 *              -> a timer / elapsed count right here on the row (lib/plan/plan-behavior.ts is the rule)
 *   Mark Done  a task with no start time and no timer: one tap checks it off
 *   Done       once an inline timer is running: the readout, Done, and a small stop
 *
 * Completed tasks leave the list (they are not deleted: they sit below, struck through, with Undo).
 * Data is plain props from the server; every write is an imported Server Action (never a function prop).
 */

const TICK_MS = 1000;

type Local = { completed: boolean; timerStartedAt: string | null };

export function PlanList({ items, nowIso }: { items: PlanItem[]; nowIso: string }) {
  const scheduleRefresh = useHomeRefresh();
  const lockIn = useLockInOverlay();
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => new Date(nowIso).getTime());

  // Fresh server data replaces whatever this list had assumed (the same row, now confirmed). Adjusted during render
  // (React's "reset state when a prop changes" pattern), not in an effect, so there is no extra stale paint.
  const [seenItems, setSeenItems] = useState(items);
  if (seenItems !== items) {
    setSeenItems(items);
    setLocal({});
  }

  const anyRunning = items.some((i) => (local[i.id]?.timerStartedAt ?? i.timerStartedAt) && !(local[i.id]?.completed ?? i.completed));
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    if (!anyRunning) return;
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  if (items.length === 0) return null;

  const view = (i: PlanItem): PlanItem => ({ ...i, completed: local[i.id]?.completed ?? i.completed, timerStartedAt: local[i.id] ? local[i.id]!.timerStartedAt : i.timerStartedAt });
  const rows = items.map(view);
  const pending = rows.filter((r) => !r.completed);
  const done = rows.filter((r) => r.completed);

  function say(id: string, message: string | null) {
    setMessages((m) => {
      const next = { ...m };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });
  }

  async function complete(item: PlanItem, completed: boolean) {
    say(item.id, null);
    setLocal((l) => ({ ...l, [item.id]: { completed, timerStartedAt: completed ? null : item.timerStartedAt } }));
    const res = await setPlanItemCompleted(item.id, completed);
    if (!res.ok) {
      setLocal((l) => {
        const next = { ...l };
        delete next[item.id];
        return next;
      });
      say(item.id, res.message);
    }
    scheduleRefresh();
  }

  async function start(item: PlanItem) {
    say(item.id, null);
    // The provider already knows about a running session: open it instead of asking the server to refuse.
    if (item.timerStartedAt === null && lockIn.session) {
      say(item.id, "Another session is already running. Opening it.");
      lockIn.expand();
      return;
    }
    setBusy(item.id);
    const res = await startPlanItem(item.id);
    setBusy(null);
    if (!res.ok) {
      if (res.activeSession) lockIn.adoptSession(res.activeSession);
      return say(item.id, res.message);
    }
    if (res.kind === "timer") setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: res.startedAt } }));
    // The action returns the running session, so the Lock-In overlay opens at once (nothing else tells the
    // provider); Home and the Business screens catch up in the background.
    else {
      lockIn.adoptSession(res.session);
      void refreshBusinessViews().catch(() => {});
    }
    scheduleRefresh();
  }

  async function stop(item: PlanItem) {
    setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: null } }));
    const res = await stopPlanItemTimer(item.id);
    if (!res.ok) say(item.id, res.message);
    scheduleRefresh();
  }

  return (
    <div className="flex flex-col gap-1" data-testid="plan-list">
      <h3 className="px-3 pt-1 text-xs font-medium text-muted-foreground">Today&apos;s plan</h3>
      <ul className="flex flex-col gap-1">
        {pending.map((item) => {
          const behavior = startBehavior(item.area, { startTime: item.startTime, durationMinutes: item.durationMinutes });
          const running = item.timerStartedAt !== null;
          const readout = running ? timerReadout(new Date(item.timerStartedAt!).getTime(), item.durationMinutes, nowMs) : null;
          const meta = [item.area ? PLAN_AREA_LABEL[item.area] : null, item.startTime ? formatHHMM12(item.startTime) : null, item.durationMinutes !== null ? formatDuration(item.durationMinutes) : null].filter((m): m is string => m !== null);
          return (
            <li key={item.id} data-testid="plan-row" className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2", item.mitRank === 1 && "bg-primary/5")}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {item.mitRank === 1 ? <span aria-label="crowned" className="mr-1.5">★</span> : null}
                  {item.title}
                </p>
                {meta.length > 0 ? <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p> : null}
                {messages[item.id] ? (
                  <p role="alert" className="text-xs text-destructive">
                    {messages[item.id]}
                  </p>
                ) : null}
              </div>

              {running && readout ? (
                <>
                  <span data-testid="plan-timer" aria-live="off" className={cn("shrink-0 font-mono text-sm tabular-nums", readout.done && "text-primary")}>
                    {readout.done ? "Time's up" : `${readout.mode === "up" ? "" : "−"}${formatClockSeconds(readout.seconds)}`}
                  </span>
                  <button type="button" onClick={() => void stop(item)} aria-label={`Stop timer for ${item.title}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                    <Square className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => void complete(item, true)} aria-label={`Complete ${item.title}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                    <Check className="size-3.5" aria-hidden />
                    Done
                  </button>
                </>
              ) : behavior.kind === "complete_only" ? (
                <button type="button" onClick={() => void complete(item, true)} aria-label={`Mark ${item.title} done`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-3 text-xs font-medium">
                  <Check className="size-3.5" aria-hidden />
                  Mark Done
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void start(item)}
                  disabled={busy === item.id}
                  aria-label={`Start ${item.title}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy === item.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                  {busy === item.id ? "Starting" : "Start"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {done.length > 0 ? (
        <ul className="flex flex-col gap-0.5 px-3 pt-1" aria-label="Completed plan items">
          {done.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate line-through">{item.title}</span>
              <button type="button" onClick={() => void complete(item, false)} aria-label={`Undo ${item.title}`} className="shrink-0 underline underline-offset-4">
                Undo
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
