"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { startWorkSession } from "@/app/(app)/business/actions";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import type { TriggerSummary } from "@/lib/distractions/types";
import { Button } from "@/components/ui/button";
import { ActionPlanDialog } from "@/components/home/action-plan-dialog";

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
      <Link href="/business" prefetch className="text-sm text-accent-business hover:underline">
        Open session →
      </Link>
    </div>
  );
}

// Distractions are correlated to focus (spec 2026-08-23 §6) — this
// subsection lives beneath the Focus content in the same panel, not as its
// own module. Excludes plan-less triggers outright (via ActionPlanDialog's
// rankTriggersForPlanList) — they're still waiting on tonight's review.
function DistractionsSection({
  distractionsToday,
  triggers,
}: {
  distractionsToday: number;
  triggers: TriggerSummary[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Distractions</p>
        <p data-testid="home-distractions-count" className="font-mono text-lg font-semibold tabular-nums">
          {distractionsToday}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
        Action Plan
      </Button>
      <ActionPlanDialog open={dialogOpen} onOpenChange={setDialogOpen} triggers={triggers} />
    </div>
  );
}

export function FocusModule({
  focusMinutesToday,
  sessionCount,
  activeSession: initialActiveSession,
  distractionsToday,
  triggers,
}: {
  focusMinutesToday: number;
  sessionCount: number;
  activeSession: ActiveSession | null;
  distractionsToday: number;
  triggers: TriggerSummary[];
}) {
  const [activeSession, setActiveSession] = useState(initialActiveSession);
  const [isPending, startTransition] = useTransition();

  function handleLockIn() {
    startTransition(async () => {
      const result = await startWorkSession();
      setActiveSession({ id: result.id, startedAtIso: result.startedAt });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {activeSession ? (
        <ActiveView startedAtIso={activeSession.startedAtIso} />
      ) : (
        // Lock In moved to the right of the Focus content, full-height
        // aligned, instead of stacked beneath it (spec 2026-08-23 §6).
        <div className="flex items-stretch justify-between gap-3">
          <div className="flex flex-col justify-center gap-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatElapsedDuration(focusMinutesToday * 60_000)}
            </p>
            <p className="text-xs text-muted-foreground">
              {sessionCount === 0 ? "No Lock-In sessions yet today" : `${sessionCount} Lock-In session${sessionCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <Button type="button" onClick={handleLockIn} disabled={isPending} className="shrink-0 self-stretch px-6">
            Lock In
          </Button>
        </div>
      )}
      <DistractionsSection distractionsToday={distractionsToday} triggers={triggers} />
    </div>
  );
}
