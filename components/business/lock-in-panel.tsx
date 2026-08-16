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
}: {
  initialSession: ActiveSessionData | null;
  lastSession: LastSessionData | null;
  // Opus Lead review (2026-08-16): idle used to be a single button in an
  // otherwise-empty 7-column panel. Required, not optional — an idle panel
  // with nothing to show isn't a state this composition should silently
  // fall back into; the caller always has a real number, even "0m".
  todayFocusMinutes: number;
}) {
  const [session, setSession] = useState(initialSession);
  const [isPending, startTransition] = useTransition();

  if (session) {
    return (
      <LockInSession
        sessionId={session.id}
        startedAtIso={session.startedAtIso}
        initialCheckins={session.checkins}
        onEnded={() => setSession(null)}
      />
    );
  }

  function handleLockIn() {
    startTransition(async () => {
      const result = await startWorkSession();
      setSession({ id: result.id, startedAtIso: result.startedAt, checkins: [] });
    });
  }

  const lastSessionMinutesMs = lastSession
    ? new Date(lastSession.endedAtIso).getTime() - new Date(lastSession.startedAtIso).getTime()
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">
          {formatElapsedDuration(todayFocusMinutes * 60_000)}
        </p>
      </div>
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
