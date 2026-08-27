"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { KIND_LABEL, type WorkSessionKind } from "@/lib/business/work-session-kind";
import { useLockInOverlay, type ActiveWorkSession } from "@/components/business/lock-in-overlay-context";
import type { TriggerSummary } from "@/lib/distractions/types";
import { Button } from "@/components/ui/button";
import { ActionPlanDialog } from "@/components/home/action-plan-dialog";

// Elapsed is minute-precision (formatElapsedDuration floors partial
// minutes), so a 60s tick matches LockInSession/PriorityList's convention
// rather than re-rendering every second for no visible change.
const TICK_MS = 60 * 1000;

// The Home Focus module is deliberately self-sufficient for ending a
// session (spec 2026-08-24, Opus Lead): a deep_study session has no domain
// page that owns it — School gets no session UI this round — so sending the
// user to /business to end a study session isn't an option. Only a
// deep_work session also links onward to /business, where the same session
// still shows via LockInSession's own view.
function ActiveView({
  session,
  isPending,
  onEnd,
  onExpand,
}: {
  session: ActiveWorkSession;
  isPending: boolean;
  onEnd: () => void;
  onExpand: () => void;
}) {
  const [now, setNow] = useState(() => new Date(session.startedAtIso));

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [session.startedAtIso]);

  const elapsed = formatElapsedDuration(now.getTime() - new Date(session.startedAtIso).getTime());

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
      <div className="flex shrink-0 flex-col gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onExpand}>
          Expand
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onEnd}>
          End session
        </Button>
      </div>
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
      {/* Visible text stays the app-wide "Lock In" verb (Lead review,
          2026-08-24) — aria-label carries the kind distinction for
          assistive tech without changing the visual design. Two buttons
          both named "Lock In" with only a visually-adjacent label to tell
          them apart is a real accessibility defect (a screen-reader user
          hears "Lock In button" twice with no way to distinguish), caught
          by e2e/home.spec.ts's strict-mode getByRole failure once it
          resolved two matches instead of one. */}
      <Button
        type="button"
        onClick={onLockIn}
        disabled={disabled}
        aria-label={`Lock In — ${KIND_LABEL[kind]}`}
        className="shrink-0 self-stretch px-6"
      >
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
  distractionsToday,
  triggers,
}: {
  deepWorkMinutes: number;
  deepWorkSessions: number;
  deepStudyMinutes: number;
  deepStudySessions: number;
  distractionsToday: number;
  triggers: TriggerSummary[];
}) {
  const { session, isPending, error, startSession, endSession, expand } = useLockInOverlay();

  return (
    <div className="flex flex-col gap-3">
      {session ? (
        <ActiveView session={session} isPending={isPending} onEnd={endSession} onExpand={expand} />
      ) : (
        <>
          <IdleRow
            kind="deep_work"
            minutes={deepWorkMinutes}
            sessions={deepWorkSessions}
            disabled={isPending}
            onLockIn={() => startSession("deep_work")}
          />
          <IdleRow
            kind="deep_study"
            minutes={deepStudyMinutes}
            sessions={deepStudySessions}
            disabled={isPending}
            onLockIn={() => startSession("deep_study")}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
      <DistractionsSection distractionsToday={distractionsToday} triggers={triggers} />
    </div>
  );
}
