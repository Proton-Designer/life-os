"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { startWorkSession } from "@/app/(app)/business/actions";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { Button } from "@/components/ui/button";

// Elapsed is minute-precision (formatElapsedDuration floors partial
// minutes), so a 60s tick matches LockInSession/PriorityList's convention
// rather than re-rendering every second for no visible change.
const TICK_MS = 60 * 1000;

type ActiveSession = { id: string; startedAtIso: string };

function ActiveView({ startedAtIso }: { startedAtIso: string }) {
  const [now, setNow] = useState(() => new Date(startedAtIso));

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [startedAtIso]);

  const elapsed = formatElapsedDuration(now.getTime() - new Date(startedAtIso).getTime());

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Locked in</p>
      <p className="font-mono text-2xl font-semibold tabular-nums">{elapsed}</p>
      <Link href="/business" className="text-sm text-accent-business hover:underline">
        Open session →
      </Link>
    </div>
  );
}

export function FocusModule({
  focusMinutesToday,
  sessionCount,
  activeSession: initialActiveSession,
}: {
  focusMinutesToday: number;
  sessionCount: number;
  activeSession: ActiveSession | null;
}) {
  const [activeSession, setActiveSession] = useState(initialActiveSession);
  const [isPending, startTransition] = useTransition();

  if (activeSession) {
    return <ActiveView startedAtIso={activeSession.startedAtIso} />;
  }

  function handleLockIn() {
    startTransition(async () => {
      const result = await startWorkSession();
      setActiveSession({ id: result.id, startedAtIso: result.startedAt });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">
          {formatElapsedDuration(focusMinutesToday * 60_000)}
        </p>
        <p className="text-xs text-muted-foreground">
          {sessionCount === 0 ? "No Lock-In sessions yet today" : `${sessionCount} Lock-In session${sessionCount === 1 ? "" : "s"}`}
        </p>
      </div>
      <Button type="button" onClick={handleLockIn} disabled={isPending} className="w-full">
        Lock In
      </Button>
    </div>
  );
}
