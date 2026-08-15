"use client";

import { useState, useTransition } from "react";
import { startWorkSession } from "@/app/(app)/business/actions";
import { LockInSession, type SessionCheckin } from "./lock-in-session";
import { Button } from "@/components/ui/button";

export type ActiveSessionData = {
  id: string;
  startedAtIso: string;
  checkins: SessionCheckin[];
};

// Optimistic local state, not router.refresh()-based — the recent
// focus-refresh regression (reverted 2026-08-14) showed a broad refresh can
// bust caches on routes it never touched. startWorkSession()'s return value
// is enough to show the active-session view immediately with no reload.
export function LockInPanel({ initialSession }: { initialSession: ActiveSessionData | null }) {
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

  return (
    <Button type="button" onClick={handleLockIn} disabled={isPending} className="w-full">
      Lock In
    </Button>
  );
}
