"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Minimize2 } from "lucide-react";
import { useLockInOverlay } from "./lock-in-overlay-context";
import { elapsedMinutesSince } from "@/lib/business/format-elapsed";
import { KIND_LABEL } from "@/lib/business/work-session-kind";
import { DistractionCaptureDialog } from "@/components/distractions/distraction-capture-dialog";
import { LockInKillList } from "./lock-in-kill-list";
import type { KillListSlotData } from "./kill-list";
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
// overlay (DistractionCaptureDialog, the allocation check-in gate, the
// check-in toast) needs to be raised further still while the overlay is
// open — see the body[data-lock-in-overlay-open] rule in globals.css.
export function LockInOverlay({
  timezone,
  killListSlots,
}: {
  timezone: string;
  killListSlots: [KillListSlotData, KillListSlotData, KillListSlotData];
}) {
  const { session, minimized, isPending, minimize, endSession } = useLockInOverlay();
  const visible = !!session && !minimized;
  const now = useTickingClock(visible);

  useEffect(() => {
    if (!visible) return;
    document.body.dataset.lockInOverlayOpen = "true";
    return () => {
      delete document.body.dataset.lockInOverlayOpen;
    };
  }, [visible]);

  if (!session || minimized) return null;

  const minutes = Math.max(0, elapsedMinutesSince(session.startedAtIso, now));
  const clockLabel = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(now);
  const kindLabel = KIND_LABEL[session.kind];

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
            "fixed inset-0 z-[60] flex flex-col items-center justify-between overflow-hidden p-6 text-foreground outline-none",
            "duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
          )}
        >
          {/* A separate layer, not a background on Content itself — the
              aurora's own opacity-pulse keyframe (globals.css) must dim only
              this decorative layer, never the readable title/stopwatch/
              buttons that sit in front of it. -z-10 forces it behind every
              sibling regardless of their own position (found live at 390px,
              batch 3: the pulse was originally on Content and washed out
              the whole card, letting the page behind bleed through). */}
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 -z-10",
              session.kind === "deep_work" ? "lock-in-aurora-business" : "lock-in-aurora-school"
            )}
          />
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
              session — Ayman, 2026-08-28. Two separate renders, not one
              reflowed with CSS flex-direction: the desktop row sits above
              the header/timer block, the mobile column sits below it —
              genuinely different positions in the layout, not just a
              different axis on the same one. */}
          {session.kind === "deep_work" && (
            <LockInKillList
              slots={killListSlots}
              className="hidden w-full flex-row flex-wrap items-center justify-center gap-3 sm:flex"
            />
          )}

          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <p className="text-lg font-medium uppercase tracking-[0.2em] text-foreground/80">{kindLabel}</p>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-8xl font-semibold tabular-nums sm:text-9xl">{minutes}</span>
              <span className="text-xl text-foreground/70">min</span>
            </div>
            <p className="font-mono text-lg tabular-nums text-foreground/70">{clockLabel}</p>

            {session.kind === "deep_work" && (
              <LockInKillList
                slots={killListSlots}
                className="flex w-full max-w-sm flex-col gap-2 sm:hidden"
              />
            )}
          </div>

          <div className="flex w-full flex-col items-center gap-4 pb-2">
            <DistractionCaptureDialog />
            <Button type="button" variant="outline" size="lg" disabled={isPending} onClick={endSession}>
              End Session
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
