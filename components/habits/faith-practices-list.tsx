"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { archiveDeenHabit } from "@/app/(app)/deen/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FaithPractice } from "@/lib/deen/practices";
import { describeFrequency } from "@/lib/habits/frequency";

/** Daily keeps its original wording ("Done 12 of last 30 days"); the other cadences speak in their own unit. */
function adherenceSentence(r: FaithPractice["rollingRate"]): string {
  switch (r.unit) {
    case "week":
      return `Hit the goal ${r.done} of the last ${r.total} weeks`;
    case "month":
      return `Hit the goal ${r.done} of the last ${r.total} months`;
    case "completion":
      return `Done ${r.done} of about ${r.total} expected in the last 30 days`;
    default:
      return `Done ${r.done} of last ${r.total} days`;
  }
}

const STAGE_LABEL: Record<FaithPractice["stage"], string> = {
  active_build: "Building",
  stabilized: "Stabilised",
  locked: "Locked",
};

function DropDialog({
  practice,
  onOpenChange,
  onDropped,
}: {
  practice: FaithPractice | null;
  onOpenChange: (open: boolean) => void;
  onDropped: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!practice) return;
    setError(null);
    startTransition(async () => {
      try {
        await archiveDeenHabit(practice.id);
        onDropped(practice.id);
        onOpenChange(false);
      } catch {
        setError("Couldn't stop tracking this practice. Try again.");
      }
    });
  }

  return (
    <Dialog open={practice !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop tracking &ldquo;{practice?.name}&rdquo;?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Stop tracking this practice? Its history is kept.</p>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirm} disabled={pending}>
              Stop tracking
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * /week step 3, under the identity list: the Faith practices (deen_habits). Shows the stage and
 * how consistently each was done, and lets the user drop one (archive, history kept). No Keep
 * button — it would only acknowledge, and doing nothing already keeps a practice. No Pause —
 * deen_habits has no paused state (adding one needs a migration). Edits live on the Faith screen.
 * Renders nothing when empty (Deen OFF passes []).
 */
export function FaithPracticesList({ practices }: { practices: FaithPractice[] }) {
  const [dropped, setDropped] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<FaithPractice | null>(null);
  const visible = practices.filter((p) => !dropped.includes(p.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="faith-practices">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Faith practices</span>
        <Link href="/deen" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Edit on the Faith screen
        </Link>
      </div>
      <ul className="flex flex-col gap-2">
        {visible.map((p) => (
          <li key={p.id} data-testid="faith-practice-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{p.name}</span>
              <span className="block text-xs text-muted-foreground">
                {p.frequency.kind === "daily" ? null : <>{describeFrequency(p.frequency)} · </>}
                {adherenceSentence(p.rollingRate)}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{STAGE_LABEL[p.stage]}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(p)} aria-label={`Drop ${p.name}`}>
              Drop
            </Button>
          </li>
        ))}
      </ul>
      <DropDialog
        practice={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        onDropped={(id) => setDropped((d) => [...d, id])}
      />
    </div>
  );
}
