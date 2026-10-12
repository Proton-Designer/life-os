"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Minimize2, Check, Pause } from "lucide-react";
import { useLockInOverlay } from "./lock-in-overlay-context";
import { formatClockSeconds } from "@/lib/plan/plan-behavior";
import { formatClock12 } from "@/lib/date-utils";
import { elapsedMinutesSince } from "@/lib/business/format-elapsed";
import { goalProgress } from "@/lib/business/session-goal";
import { KIND_LABEL } from "@/lib/business/work-session-kind";
import { DistractionCaptureDialog } from "@/components/distractions/distraction-capture-dialog";
import { HourCompleteBanner } from "./hour-complete-banner";
import { EndOfHourReflection } from "./end-of-hour-reflection";
import { LockInKillList } from "./lock-in-kill-list";
import { LockInObjectives } from "./lock-in-objectives";
import type { KillListSlotData } from "./kill-list";
import type { SessionObjective } from "@/lib/business/session-objectives";
import type { HourWorkInterval } from "@/lib/reflection-cards/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TICK_MS = 1000;

function useTickingClock(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [enabled]);
  return now;
}

/** Directly under the elapsed time, above the clock (Ayman, exact
 * placement). Ticks off the same `now` as the elapsed counter, not its own
 * clock — one instant driving every time-derived number on this screen, so
 * they can never visibly disagree by a frame. Only ever rendered when
 * `session.goalMinutes !== null` (see the caller), so there's no "0-goal"
 * div-width edge case to guard here. */
function GoalProgressBar({ fraction }: { fraction: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-foreground/15"
    >
      <div className="h-full rounded-full bg-foreground transition-[width] duration-1000 ease-linear" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

/** The single custom objective (at most one, DB-enforced), rendered as the
 * headline ABOVE the DEEP WORK/DEEP STUDY title — Ayman's own phrasing: "it
 * is the headline, not a list item" (carried over from the setup dialog's
 * own header comment on why it's never folded into LockInObjectives).
 * Still a real, toggleable objective — "every objective... gets a
 * checkmark" applies here too, just styled for its position rather than as
 * a pill like the checklist below it. */
function CustomObjectiveHeadline({ objective, onToggle }: { objective: SessionObjective; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={objective.completed}
      aria-label={objective.completed ? `Mark "${objective.label}" incomplete` : `Mark "${objective.label}" complete`}
      className={cn(
        "flex max-w-md items-center gap-3 text-center text-2xl font-semibold text-foreground transition-colors sm:text-3xl",
        objective.completed && "text-foreground/50 line-through"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          objective.completed ? "border-foreground bg-foreground" : "border-foreground/50"
        )}
      >
        {objective.completed && <Check className="size-4 text-background" strokeWidth={3} />}
      </span>
      {objective.label}
    </button>
  );
}

// The provider-level session survives navigation; this overlay is the
// full-screen PRESENTATION of it, shown whenever a session is active and
// not minimized. Built directly on the radix Dialog primitive (not the
// app's styled Dialog wrapper, whose centered-card layout doesn't fit a
// full-screen takeover) so it gets role="dialog"/aria-modal, focus trap,
// and body-scroll-lock for free — the same mechanism DistractionCaptureDialog
// nests inside without any extra wiring.
//
// z-[60]: deliberately above mobile-island and the topbar (both z-50/z-40 —
// Lead review, 2026-08-27) so "full screen" really is full screen on
// mobile, not covered by the floating nav pill. That in turn puts it above
// every app Dialog's normal z-50 too, so anything popped up FROM inside the
// overlay (DistractionCaptureDialog) needs to be raised further still while the overlay is
// open — see the body[data-lock-in-overlay-open] rule in globals.css.
export function LockInOverlay({
  timezone,
  killListSlots,
  deenMode = false,
}: {
  timezone: string;
  killListSlots: [KillListSlotData, KillListSlotData, KillListSlotData];
  /** profiles.deen_mode as a plain boolean; gates the Deen option in the distraction capture dialog. */
  deenMode?: boolean;
}) {
  const { session, minimized, isPending, minimize, endSession, pauseSession, completePlanSession, toggleObjective } = useLockInOverlay();
  const visible = !!session && !minimized;
  const now = useTickingClock(visible);

  useEffect(() => {
    if (!visible) return;
    document.body.dataset.lockInOverlayOpen = "true";
    // Freeze the page behind the full-screen view. `overflow: hidden` alone doesn't stop iOS/iPadOS Safari from scrolling
    // the page under a fixed layer (the scrollbar moves, the site peeks out at the edge), so the body is pinned in place
    // and the scroll position restored on minimize.
    const { body, documentElement: html } = document;
    const scrollY = window.scrollY;
    const prev = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overscroll: html.style.overscrollBehavior };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    html.style.overscrollBehavior = "none";
    return () => {
      delete body.dataset.lockInOverlayOpen;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      html.style.overscrollBehavior = prev.overscroll;
      window.scrollTo(0, scrollY);
    };
  }, [visible]);

  if (!session || minimized) return null;

  const minutes = Math.max(0, elapsedMinutesSince(session.startedAtIso, now));
  // 12-hour whatever the browser locale (Intl.DateTimeFormat(undefined, ...) showed "13:06" on a 24-hour locale).
  const clockLabel = formatClock12(now, timezone);
  const kindLabel = KIND_LABEL[session.kind];

  // The switch between "legacy" (render exactly as before 146) and
  // "goal-based" presentation is session.goalMinutes, NOT
  // session.objectives.length — a goal-based session with zero objectives
  // picked at setup still gets the goal display/progress bar and the
  // (correctly empty) LockInObjectives, never the old full-kill-list view.
  // Backward compatibility (Opus Lead's explicit requirement): a legacy
  // in-flight session already running when this deployed has goalMinutes
  // null and must render pixel-for-pixel as it did before this feature —
  // bare elapsed counter, no `/ goal`, no progress bar, the old
  // LockInKillList. isGoalBased is that one boolean gate for all of it.
  // A session IS real work (nothing is confirmed hour by hour any more), so the last full hour is one honest interval.
  const hourInterval: HourWorkInterval[] =
    minutes >= 60 ? [{ domain: session.kind, minutes: Math.min(minutes, 60), isDistraction: false }] : [];
  const isGoalBased = session.goalMinutes !== null;
  const progress = isGoalBased ? goalProgress(session.startedAtIso, session.goalMinutes as number, now) : null;
  // At most one custom objective (DB-enforced) — pulled out to render as
  // the headline above kindLabel; LockInObjectives never receives it.
  const customObjective = session.objectives.find((o) => o.kind === "custom") ?? null;
  const checklistObjectives = session.objectives.filter((o) => o.kind !== "custom");

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        // The dialog primitive treats any dismissal (outside click, Escape)
        // as "close" — for this overlay that must always mean minimize,
        // never end the session.
        if (!open) minimize();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            minimize();
          }}
          aria-label={`${kindLabel} — locked in`}
          className={cn(
            "fixed inset-0 z-[60] flex h-dvh flex-col items-center justify-between overflow-hidden overscroll-none p-6 text-foreground outline-none",
            "duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
          )}
        >
          {/* A separate layer, not a background on Content itself — the
              aurora's own brightness drift (globals.css) must dim only
              this decorative layer, never the readable title/stopwatch/
              buttons that sit in front of it. -z-10 forces it behind every
              sibling regardless of their own position. The same black and
              maroon aurora for Deep Work and Deep Study. */}
          <div aria-hidden className="lock-in-aurora absolute inset-0 -z-10" />
          <DialogPrimitive.Title className="sr-only">{kindLabel} — locked in</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Full-screen Lock-In session view. Minimize to return to the app while the session keeps running.
          </DialogPrimitive.Description>

          <div className="flex w-full justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Minimize session"
              onClick={minimize}
              className="text-foreground/80 hover:text-foreground"
            >
              <Minimize2 />
            </Button>
          </div>

          {/* Kill list is Business-domain (kill_list_items has no
              deep_study equivalent), so it only ever shows for a Deep Work
              session — Ayman, 2026-08-28. Only for a LEGACY session
              (isGoalBased false) — a goal-based session shows its own
              chosen objectives instead (LockInObjectives, below), which
              replaces this component entirely rather than sitting beside
              it. Two separate renders, not one reflowed with CSS
              flex-direction: the desktop row sits above the header/timer
              block, the mobile column sits below it — genuinely different
              positions in the layout, not just a different axis on the
              same one. Same split repeated for LockInObjectives immediately
              below each. */}
          {session.kind === "deep_work" && !isGoalBased && (
            <LockInKillList
              slots={killListSlots}
              className="hidden w-full flex-row flex-wrap items-center justify-center gap-3 sm:flex"
            />
          )}
          {isGoalBased && (
            <LockInObjectives
              objectives={checklistObjectives}
              className="hidden w-full flex-row flex-wrap items-center justify-center gap-3 sm:flex"
            />
          )}

          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            {isGoalBased && customObjective && (
              <CustomObjectiveHeadline objective={customObjective} onToggle={() => toggleObjective(customObjective.id)} />
            )}
            <p className="text-lg font-medium uppercase tracking-[0.2em] text-foreground/80">{kindLabel}</p>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-8xl font-semibold tabular-nums sm:text-9xl">{minutes}</span>
              <span className="text-xl text-foreground/70">min</span>
              {/* Ayman: "/ 30" in noticeably smaller text than the elapsed
                  counter — text-xl beside the counter's text-8xl/9xl, and
                  dimmer (foreground/50 vs the counter's full-opacity
                  foreground), so it reads as a subordinate annotation, not
                  a second number competing with the first. */}
              {isGoalBased && (
                <span className="font-mono text-xl tabular-nums text-foreground/50">/ {session.goalMinutes}</span>
              )}
            </div>
            {/* Directly under elapsed, above the clock — exact placement
                Ayman specified. Only for a goal-based session; nothing
                renders here for a legacy one. */}
            {isGoalBased && progress && <GoalProgressBar fraction={progress.fraction} />}
            <p className="font-mono text-lg tabular-nums text-foreground/70">{clockLabel}</p>
            {/* A resumed plan line: the time already worked before this session (banked from the earlier, paused stretches). */}
            {session.planTaskId && (session.bankedSeconds ?? 0) > 0 && (
              <p className="text-sm text-foreground/60" data-testid="banked-caption">
                {formatClockSeconds(session.bankedSeconds ?? 0)} already worked on this task
              </p>
            )}
            <HourCompleteBanner elapsedMinutes={minutes} />
            <EndOfHourReflection elapsedMinutes={minutes} intervals={hourInterval} />

            {session.kind === "deep_work" && !isGoalBased && (
              <LockInKillList
                slots={killListSlots}
                className="flex w-full max-w-sm flex-col gap-2 sm:hidden"
              />
            )}
            {isGoalBased && (
              <LockInObjectives
                objectives={checklistObjectives}
                className="flex w-full max-w-sm flex-col gap-2 sm:hidden"
              />
            )}
          </div>

          <div className="flex w-full flex-col items-center gap-4 pb-2">
            <DistractionCaptureDialog deenMode={deenMode} />
            {/* A session working on a PLAN LINE (Home's Today list) offers Pause + Mark Done instead of End Session: both end the
                session through the End Session path and bank its time on the line; Mark Done also completes it. Every other
                session keeps End Session exactly as it was. */}
            {session.planTaskId ? (
              <div className="flex flex-wrap items-center justify-center gap-3" data-testid="plan-session-actions">
                <Button type="button" variant="outline" size="lg" disabled={isPending} onClick={() => void pauseSession().catch(() => {})}>
                  <Pause aria-hidden />
                  Pause
                </Button>
                <Button type="button" size="lg" disabled={isPending} onClick={() => void completePlanSession().catch(() => {})}>
                  <Check aria-hidden />
                  Mark Done
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="lg" disabled={isPending} onClick={endSession}>
                End Session
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
