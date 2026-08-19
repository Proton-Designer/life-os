"use client";

import { useState, useTransition } from "react";
import { startWorkSession } from "@/app/(app)/business/actions";
import { LockInSession, type SessionCheckin } from "./lock-in-session";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { Button } from "@/components/ui/button";

export type ActiveSessionData = {
  id: string;
  startedAtIso: string;
  checkins: SessionCheckin[];
  sessionSignalMinutes: number;
  sessionNoiseMinutes: number;
};

export type LastSessionData = {
  startedAtIso: string;
  endedAtIso: string;
};

// Optimistic local state, not router.refresh()-based — the recent
// focus-refresh regression (reverted 2026-08-14) showed a broad refresh can
// bust caches on routes it never touched. startWorkSession()'s return value
// is enough to show the active-session view immediately with no reload.
export function LockInPanel({
  initialSession,
  lastSession,
  todayFocusMinutes,
  showTodayTotal = true,
}: {
  initialSession: ActiveSessionData | null;
  lastSession: LastSessionData | null;
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
  const [session, setSession] = useState(initialSession);
  const [isPending, startTransition] = useTransition();

  if (session) {
    return (
      <LockInSession
        sessionId={session.id}
        startedAtIso={session.startedAtIso}
        initialCheckins={session.checkins}
        sessionSignalMinutes={session.sessionSignalMinutes}
        sessionNoiseMinutes={session.sessionNoiseMinutes}
        onEnded={() => setSession(null)}
      />
    );
  }

  function handleLockIn() {
    startTransition(async () => {
      const result = await startWorkSession();
      setSession({
        id: result.id,
        startedAtIso: result.startedAt,
        checkins: [],
        sessionSignalMinutes: 0,
        sessionNoiseMinutes: 0,
      });
    });
  }

  const lastSessionMinutesMs = lastSession
    ? new Date(lastSession.endedAtIso).getTime() - new Date(lastSession.startedAtIso).getTime()
    : 0;

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
      {lastSession && (
        <p className="text-xs text-muted-foreground">
          Last session: {formatElapsedDuration(lastSessionMinutesMs)} on{" "}
          {new Date(lastSession.startedAtIso).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </p>
      )}
      <Button type="button" onClick={handleLockIn} disabled={isPending} className="w-full">
        Lock In
      </Button>
    </div>
  );
}
