"use client";

import Link from "next/link";
import { LockInSession, type StoredSessionHour } from "./lock-in-session";
import { useLockInOverlay } from "./lock-in-overlay-context";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { KIND_LABEL } from "@/lib/business/work-session-kind";
import { Button } from "@/components/ui/button";

// Session identity/start/end/minimize/expand all come from the app-wide
// LockInOverlayProvider (batch 3) — this panel is purely the /business
// PRESENTATION of that shared state, plus the one thing only this page
// knows: the stored hourly allocations for the deep_work session that was
// already active on THIS page's own server render.
export function LockInPanel({
  initialSessionId,
  initialStoredHours,
  todayFocusMinutes,
  timezone,
  showTodayTotal = true,
}: {
  // Identifies which session `initialStoredHours` belongs to — a session
  // the context knows about that this page's render never saw (started
  // elsewhere, or freshly started right here) always begins at zero hours.
  initialSessionId: string | null;
  initialStoredHours: StoredSessionHour[];
  // A real moment in time (session start), not a calendar date — must
  // format against the user's PROFILE timezone, not the runtime's local
  // zone. Threaded down to LockInSession too.
  timezone: string;
  // Opus Lead review (2026-08-16): idle used to be a single button in an
  // otherwise-empty 7-column panel. Required, not optional — an idle panel
  // with nothing to show isn't a state this composition should silently
  // fall back into; the caller always has a real number, even "0m".
  todayFocusMinutes: number;
  // Opus Lead review (2026-08-18): the overnight Business restructure put a
  // standalone "Focus time today" card directly beside this panel, so its
  // own idle-state "Today" figure became a literal duplicate of the number
  // right next to it. This flag lets that one caller opt out without
  // weakening todayFocusMinutes' required-ness for every other caller —
  // don't delete the display outright, or a caller with no adjacent card
  // silently loses the guarantee above.
  showTodayTotal?: boolean;
}) {
  const { session, isPending, error, startSession, endSession, expand } = useLockInOverlay();

  if (session?.kind === "deep_work") {
    const storedHours = session.id === initialSessionId ? initialStoredHours : [];
    return (
      <LockInSession
        // Remounts (resetting hour-confirmation state) whenever the active
        // session's identity actually changes — ending one and starting
        // another shouldn't carry the old session's local state forward.
        key={session.id}
        sessionId={session.id}
        startedAtIso={session.startedAtIso}
        initialStoredHours={storedHours}
        timezone={timezone}
        onEndSession={endSession}
        onExpand={expand}
      />
    );
  }

  // Deep Work/Deep Study split (2026-08-24, Lead review): the single-active-
  // session guard in startWorkSession blocks a new session of EITHER kind
  // while one is running, but this page only ever shows a deep_work
  // session — a deep_study session elsewhere is invisible here otherwise,
  // which would let this panel offer a Lock In button the guard then
  // refuses, for a session the page never told the user about.
  const disabledReason = session?.kind === "deep_study" ? `${KIND_LABEL.deep_study} in progress` : null;

  return (
    <div className="flex flex-col gap-4">
      {showTodayTotal && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {formatElapsedDuration(todayFocusMinutes * 60_000)}
          </p>
        </div>
      )}
      {disabledReason && (
        <p className="text-xs text-muted-foreground">
          {disabledReason} —{" "}
          <Link href="/" prefetch className="underline hover:text-foreground">
            finish it on Home
          </Link>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        type="button"
        onClick={() => startSession("deep_work")}
        disabled={isPending || !!disabledReason}
        className="w-full"
      >
        Lock In
      </Button>
    </div>
  );
}
