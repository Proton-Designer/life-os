"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { triggerFsrsTuning } from "@/app/(app)/personal/fsrs-tuning-actions";
import { FSRS_TUNING_MIN_REVIEWS } from "@/lib/self-mastery/fsrs-tuning-constants";
import type { FsrsTuningStatus } from "@/lib/self-mastery/fsrs-tuning";

/**
 * Renders an ISO timestamp WITHOUT any timezone conversion -- same
 * hydration-mismatch reasoning as canvas-settings.tsx's own
 * `formatSyncedAt`: this Client Component's initial render also happens
 * during SSR, and a `Date`-based local-time format there would use the
 * server's timezone/locale, then re-run on the client with the browser's.
 */
function formatTrainedAt(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * P3-20 -- FSRS per-user tuning status + manual trigger. Three real
 * states: not enough reviews yet (a legible progress count, matching
 * OverconfidenceCard's own honest-gate posture), eligible but never
 * tuned, and already tuned (with a re-tune option -- the server's own
 * 24h cooldown is the real rate limit; a rejected re-tune attempt just
 * surfaces that message here, never retried automatically).
 */
export function FsrsTuningCard({ status: initialStatus }: { status: FsrsTuningStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleTune() {
    startTransition(async () => {
      const res = await triggerFsrsTuning();
      setMessage(res.message);
      if (res.ok) {
        setStatus((s) => ({ ...s, tunedAt: new Date().toISOString(), reviewCountAtTrain: s.reviewCount }));
      }
    });
  }

  return (
    <div data-testid="fsrs-tuning-card" className="flex flex-col gap-1 rounded-xl border border-border/40 p-4">
      <span className="text-sm font-medium">Review scheduling</span>
      {!status.eligible ? (
        <p className="text-xs text-muted-foreground">
          {status.reviewCount} of {FSRS_TUNING_MIN_REVIEWS} reviews logged -- personalized scheduling tunes in once you reach the minimum.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {status.tunedAt
              ? `Tuned on ${status.reviewCountAtTrain} reviews, last run ${formatTrainedAt(status.tunedAt)}.`
              : `Eligible to tune (${status.reviewCount} reviews logged).`}
          </p>
          <div>
            <Button size="sm" variant="outline" disabled={isPending} onClick={handleTune}>
              {isPending ? "Tuning…" : status.tunedAt ? "Retune" : "Tune now"}
            </Button>
          </div>
        </>
      )}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
