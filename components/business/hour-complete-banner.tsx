"use client";

import { useState } from "react";
import { X } from "lucide-react";

const HOUR_COMPLETION_MINUTES = 60;

/**
 * Phase 2 #P2-04's in-app half of the Hour-completion convenience — purely
 * client-derived from the same `elapsedMinutes` each caller already
 * computes every tick, no server round trip needed to know "my own elapsed
 * time crossed 60 minutes." The out-of-app half (a push, for when the tab
 * is backgrounded or closed) lives in lib/business/hour-completion.ts, a
 * poller piggybacked on the existing 5-minute scheduled-actions cron.
 *
 * Dismissible, not auto-timed: a Lock-In session can run for hours past
 * this mark, and a banner that silently disappears on its own is easy to
 * miss entirely if the user looked away for the wrong few seconds.
 * `dismissed` deliberately does not reset if elapsedMinutes dips back below
 * 60 (it can't, in practice — `now` only moves forward — but even a stale
 * prop briefly reading low must not resurrect a banner the user already
 * closed).
 */
export function HourCompleteBanner({ elapsedMinutes }: { elapsedMinutes: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || elapsedMinutes < HOUR_COMPLETION_MINUTES) return null;

  return (
    <div
      data-testid="hour-complete-banner"
      className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted px-3 py-2 text-sm"
    >
      <span>Hour complete — you&apos;ve been locked in for 60+ minutes.</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
