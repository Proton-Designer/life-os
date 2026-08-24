"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { startWorkSession } from "@/app/(app)/business/actions";
import { LockInSession, type StoredSessionHour } from "./lock-in-session";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { Button } from "@/components/ui/button";

export type ActiveSessionData = {
  id: string;
  startedAtIso: string;
  storedHours: StoredSessionHour[];
};

// Optimistic local state, not router.refresh()-based — the recent
// focus-refresh regression (reverted 2026-08-14) showed a broad refresh can
// bust caches on routes it never touched. startWorkSession()'s return value
// is enough to show the active-session view immediately with no reload.
export function LockInPanel({
  initialSession,
  todayFocusMinutes,
  timezone,
  showTodayTotal = true,
  disabledReason = null,
}: {
  initialSession: ActiveSessionData | null;
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
  // Deep Work/Deep Study split (2026-08-24, Lead review): the single-active-
  // session guard in startWorkSession blocks a new session of EITHER kind
  // while one is running, but this page only ever shows a deep_work
  // session — a deep_study session elsewhere is invisible here otherwise,
  // which let this panel offer a Lock In button the guard would then
  // refuse, for a session the page never told the user about. When set,
  // disables Lock In and explains why instead.
  disabledReason?: string | null;
}) {
  const [session, setSession] = useState(initialSession);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (session) {
    return (
      <LockInSession
        sessionId={session.id}
        startedAtIso={session.startedAtIso}
        initialStoredHours={session.storedHours}
        timezone={timezone}
        onEnded={() => setSession(null)}
      />
    );
  }

  function handleLockIn() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startWorkSession("deep_work");
        setSession({ id: result.id, startedAtIso: result.startedAt, storedHours: [] });
      } catch {
        // The guard can still lose a race (two tabs, a double-click) even
        // after disabledReason covers the known cross-kind case — surface
        // it as a legible inline message, not an unhandled rejection that
        // crashes the page (2026-08-24, Lead review).
        setError("A Lock-In session is already running. Reload to see it.");
      }
    });
  }

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
      <Button type="button" onClick={handleLockIn} disabled={isPending || !!disabledReason} className="w-full">
        Lock In
      </Button>
    </div>
  );
}
