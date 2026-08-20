"use client";

import { useState, useTransition } from "react";
import { startWorkSession } from "@/app/(app)/business/actions";
import { setSessionHourStatus } from "@/app/(app)/checkin/session-hour-actions";
import { LockInSession, type StoredSessionHour } from "./lock-in-session";
import { SessionHourList, type ResolvedSessionHour } from "./session-hour-list";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { Button } from "@/components/ui/button";

export type ActiveSessionData = {
  id: string;
  startedAtIso: string;
  storedHours: StoredSessionHour[];
};

export type LastSessionData = {
  sessionId: string;
  startedAtIso: string;
  endedAtIso: string;
  // docs/superpowers/specs/2026-08-19-missed-lockin-hours.md rule 3: every
  // hour stays editable after the session ends too, reachable right here —
  // not a separate edit-history screen. Already resolved server-side
  // (resolveSessionHours with the real endedAt) since a closed session's
  // hours don't need to tick.
  resolvedHours: ResolvedSessionHour[];
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
        initialStoredHours={session.storedHours}
        onEnded={() => setSession(null)}
      />
    );
  }

  function handleLockIn() {
    startTransition(async () => {
      const result = await startWorkSession();
      setSession({ id: result.id, startedAtIso: result.startedAt, storedHours: [] });
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
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Last session: {formatElapsedDuration(lastSessionMinutesMs)} on{" "}
            {new Date(lastSession.startedAtIso).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </p>
          <LastSessionHours sessionId={lastSession.sessionId} initialHours={lastSession.resolvedHours} />
        </div>
      )}
      <Button type="button" onClick={handleLockIn} disabled={isPending} className="w-full">
        Lock In
      </Button>
    </div>
  );
}

/**
 * The "after it ends" half of the missed-hours ruling — same
 * SessionHourList, same editHour shape as the live session, just no
 * ticking (a closed session's hours don't change on their own, only via
 * an explicit edit). Local optimistic state only; setSessionHourStatus
 * itself revalidates the page.
 */
function LastSessionHours({ sessionId, initialHours }: { sessionId: string; initialHours: ResolvedSessionHour[] }) {
  const [hours, setHours] = useState(initialHours);
  const [isConfirming, startConfirming] = useTransition();

  function editHour(hourStartIso: string, status: "business" | "wasted") {
    setHours((prev) =>
      prev.map((h) =>
        h.hourStartIso === hourStartIso
          ? { hourStartIso, state: status === "business" ? "confirmed_business" : "confirmed_wasted" }
          : h
      )
    );
    startConfirming(async () => {
      await setSessionHourStatus(sessionId, hourStartIso, status);
    });
  }

  return <SessionHourList hours={hours} onEdit={editHour} disabled={isConfirming} />;
}
