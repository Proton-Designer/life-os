"use client";

import { useEffect, useState } from "react";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { KIND_LABEL } from "@/lib/business/work-session-kind";
import { Button } from "@/components/ui/button";

/**
 * A slim bar under the top bar on EVERY screen while a Lock-In / Deep Study session is running and its full-screen
 * view is minimized: what is running, for how long, and the two things you can do about it (open it, end it).
 * Without this a running session is only visible on the pages that happen to draw a Focus panel.
 */
export function ActiveSessionPill() {
  const { session, minimized, isPending, expand, endSession } = useLockInOverlay();
  const [nowMs, setNowMs] = useState<number | null>(null);

  const startedAtIso = session?.startedAtIso ?? null;
  useEffect(() => {
    if (!startedAtIso) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [startedAtIso]);

  if (!session || !minimized) return null;
  const elapsed = nowMs === null ? "" : formatElapsedDuration(Math.max(0, nowMs - new Date(session.startedAtIso).getTime()));

  return (
    <div role="status" data-testid="active-session-pill" className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{KIND_LABEL[session.kind]}</span> in progress
        {elapsed ? <span className="ml-2 font-mono tabular-nums text-muted-foreground">{elapsed}</span> : null}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={expand}>
        Open
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => void endSession()}>
        End
      </Button>
    </div>
  );
}
