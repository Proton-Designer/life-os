"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { startWorkSession, endWorkSession } from "@/app/(app)/business/actions";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import type { TriggerSummary } from "@/lib/distractions/types";
import { Button } from "@/components/ui/button";
import { ActionPlanDialog } from "@/components/home/action-plan-dialog";

// Elapsed is minute-precision (formatElapsedDuration floors partial
// minutes), so a 60s tick matches LockInSession/PriorityList's convention
// rather than re-rendering every second for no visible change.
const TICK_MS = 60 * 1000;

type WorkSessionKind = "deep_work" | "deep_study";

type ActiveSession = { id: string; startedAtIso: string; kind: WorkSessionKind };

const KIND_LABEL: Record<WorkSessionKind, string> = {
  deep_work: "Deep Work",
  deep_study: "Deep Study",
};

// The Home Focus module is deliberately self-sufficient for ending a
// session (spec 2026-08-24, Opus Lead): a deep_study session has no domain
// page that owns it — School gets no session UI this round — so sending the
// user to /business to end a study session isn't an option. Only a
// deep_work session also links onward to /business, where the same session
// still shows via LockInSession's own view.
function ActiveView({
  session,
  onEnded,
}: {
  session: ActiveSession;
  onEnded: () => void;
}) {
  const [now, setNow] = useState(() => new Date(session.startedAtIso));
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [session.startedAtIso]);

  const elapsed = formatElapsedDuration(now.getTime() - new Date(session.startedAtIso).getTime());

  function handleEnd() {
    startTransition(async () => {
      await endWorkSession(session.id);
      onEnded();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[session.kind]} — locked in
        </p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{elapsed}</p>
        {session.kind === "deep_work" && (
          <Link href="/business" prefetch className="text-sm text-accent-business hover:underline">
            Open session →
          </Link>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleEnd}>
        End session
      </Button>
    </div>
  );
}

function IdleRow({
  kind,
  minutes,
  sessions,
  disabled,
  onLockIn,
}: {
  kind: WorkSessionKind;
  minutes: number;
  sessions: number;
  disabled: boolean;
  onLockIn: () => void;
}) {
  return (
    <div className="flex items-stretch justify-between gap-3">
      <div className="flex flex-col justify-center gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{KIND_LABEL[kind]}</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{formatElapsedDuration(minutes * 60_000)}</p>
        <p className="text-xs text-muted-foreground">
          {sessions === 0 ? "No sessions yet today" : `${sessions} session${sessions === 1 ? "" : "s"} today`}
        </p>
      </div>
      <Button type="button" onClick={onLockIn} disabled={disabled} className="shrink-0 self-stretch px-6">
        Lock In
      </Button>
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
  deepWorkMinutes,
  deepWorkSessions,
  deepStudyMinutes,
  deepStudySessions,
  activeSession: initialActiveSession,
  distractionsToday,
  triggers,
}: {
  deepWorkMinutes: number;
  deepWorkSessions: number;
  deepStudyMinutes: number;
  deepStudySessions: number;
  activeSession: ActiveSession | null;
  distractionsToday: number;
  triggers: TriggerSummary[];
}) {
  const [activeSession, setActiveSession] = useState(initialActiveSession);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleLockIn(kind: WorkSessionKind) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startWorkSession(kind);
        setActiveSession({ id: result.id, startedAtIso: result.startedAt, kind });
      } catch {
        // Both rows are disabled together while any Lock In is pending, so
        // this can only fire on a real race (another tab started a session
        // first) — surface it as a legible message rather than an
        // unhandled rejection that crashes the page (2026-08-24, Lead
        // review of the same bug in lock-in-panel.tsx).
        setError("A Lock-In session is already running. Reload to see it.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {activeSession ? (
        <ActiveView session={activeSession} onEnded={() => setActiveSession(null)} />
      ) : (
        <>
          <IdleRow
            kind="deep_work"
            minutes={deepWorkMinutes}
            sessions={deepWorkSessions}
            disabled={isPending}
            onLockIn={() => handleLockIn("deep_work")}
          />
          <IdleRow
            kind="deep_study"
            minutes={deepStudyMinutes}
            sessions={deepStudySessions}
            disabled={isPending}
            onLockIn={() => handleLockIn("deep_study")}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
      <DistractionsSection distractionsToday={distractionsToday} triggers={triggers} />
    </div>
  );
}
