"use client";

import { Clock } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { LockInPanel } from "@/components/business/lock-in-panel";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { cn } from "@/lib/utils";
import type { StoredSessionHour } from "@/components/business/lock-in-session";

/**
 * Business restructure (2026-08-26 night batch 3, per Ayman, verbatim):
 * "put the lock in button inside the Focus time today module, so shift the
 * minute coutn tohte left and add the lock in button on the right of
 * that." One merged card: icon + title + session-count subtext + elapsed
 * minutes on the left, LockInPanel on the right.
 *
 * A client component (not inlined in page.tsx, a Server Component) because
 * the layout decision below needs LIVE session state from the app-wide
 * LockInOverlayProvider (batch 3, C's refactor) — a session started from
 * THIS page, or from the Home Focus module in another tab, changes that
 * state with no server re-render. Deciding the layout from page.tsx's
 * initial SSR snapshot alone would go stale the instant that happens.
 *
 * Only forces a stacked layout at every width while a deep_work session is
 * ACTIVE — that's the one state where LockInPanel renders LockInSession, a
 * full multi-row card (elapsed time, signal:noise, hourly checkins) that
 * cannot sit "beside" a one-line info row without breaking at 390px
 * (Ayman's own phone, per AGENTS.md's /school overflow incident). Idle —
 * including a Deep Study session running elsewhere, which is just a line
 * of disabled-reason text — is side-by-side at EVERY width, not just sm and
 * up (Lead review, 2026-08-27: Ayman's own phone is 390px, and the button
 * on the right is the literal ask — "shift the minute count to the left
 * and add the lock in button on the right of that." A `sm:flex-row`
 * breakpoint meant the requested layout never actually appeared on his
 * device). Room is made by `min-w-0 truncate` on the text block and
 * `shrink-0` on the button's wrapper, not by a breakpoint.
 */
export function FocusTimeCard({
  sessionsTodayCount,
  focusMinutesToday,
  initialSessionId,
  initialStoredHours,
  timezone,
}: {
  sessionsTodayCount: number;
  focusMinutesToday: number;
  initialSessionId: string | null;
  initialStoredHours: StoredSessionHour[];
  timezone: string;
}) {
  const { session } = useLockInOverlay();
  const showsBigSessionCard = session?.kind === "deep_work";

  return (
    <div
      id="lock-in-panel"
      className={cn(
        "scroll-mt-20 flex gap-3 rounded-2xl border border-border/40 bg-card p-3",
        showsBigSessionCard ? "flex-col" : "flex-row items-center justify-between"
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <IconChip icon={Clock} accent="business" size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Focus time today</p>
          <p className="truncate text-xs text-muted-foreground">
            {sessionsTodayCount === 0
              ? "No Lock-In sessions yet today"
              : `${sessionsTodayCount} session${sessionsTodayCount === 1 ? "" : "s"} today`}
          </p>
        </div>
        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
          {formatElapsedDuration(focusMinutesToday * 60_000)}
        </span>
      </div>
      <div className="shrink-0">
        {/* showTodayTotal={false}: the elapsed minutes above already show this exact number. */}
        <LockInPanel
          initialSessionId={initialSessionId}
          initialStoredHours={initialStoredHours}
          todayFocusMinutes={focusMinutesToday}
          timezone={timezone}
          showTodayTotal={false}
        />
      </div>
    </div>
  );
}
