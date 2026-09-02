"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { RetrievalSessionOverlay } from "./retrieval-session-overlay";
import { retryStarterDeckSeed } from "@/app/(app)/personal/self-mastery-session-actions";

/**
 * Home's entry point (D-003): "12 cards due, ~7 min." Server-fetched via
 * getDueSummary and passed in as a plain prop -- this component itself
 * never calls start_session, so a user glancing at Home without tapping in
 * never creates a work_sessions row for it. Tapping in opens the same
 * overlay whether there's a real queue or the user is already caught up
 * (the "nothing due today" success state lives inside the overlay, not
 * here, so this card's own copy never has to guess which one it is).
 */
export function SessionEntryCard({
  dueSummary,
}: {
  dueSummary: { dueCount: number; newCount: number; estimatedMinutes: number; starterDeckMissing: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const router = useRouter();

  if (!dueSummary) return null;

  // A seed that never landed (Boss ruling, R7) gets its own state,
  // deliberately separate from every other branch below -- it must never
  // read as "Nothing due today," which is the caught-up state's honest
  // copy for a REAL empty deck, not a stand-in for "nothing ever arrived."
  // Tapping retries the same idempotent RPC the onboarding seed step
  // itself calls, rather than opening a session overlay with nothing in
  // it to review.
  if (dueSummary.starterDeckMissing) {
    const handleRetry = async () => {
      setIsRetrying(true);
      setRetryFailed(false);
      const result = await retryStarterDeckSeed();
      if (result.ok) {
        // Left retrying=true through the refresh -- once the parent
        // Server Component's data comes back with starterDeckMissing
        // false, this branch is skipped entirely on the next render, so
        // there's no stale "Retry" flash to reset here.
        router.refresh();
      } else {
        setIsRetrying(false);
        setRetryFailed(true);
      }
    };

    return (
      <button
        type="button"
        onClick={() => void handleRetry()}
        disabled={isRetrying}
        className="flex w-full items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 text-left transition-colors hover:bg-accent/50 disabled:opacity-70"
      >
        <IconChip icon={BookOpen} accent="business" />
        <div className="flex-1">
          <div className="text-sm font-medium">Your starter deck didn&apos;t load</div>
          <div className="text-xs text-muted-foreground">
            {retryFailed ? "Couldn't load it. Check your connection and try again." : "Self-Mastery"}
          </div>
        </div>
        <span
          aria-hidden
          className="rounded-lg border border-border bg-background px-2.5 py-1 text-sm font-medium"
        >
          {isRetrying ? "Retrying..." : "Retry"}
        </span>
      </button>
    );
  }

  // Three genuinely different states, not two -- "due" (real review debt),
  // "ready to start" (a fresh/seeded deck nobody's touched yet, dueCount=0
  // for an honest reason, not because there's nothing to do), and actually
  // caught up. Collapsing "ready to start" into "Nothing due today" reads
  // as broken on day one (Opus Lead, stranger-journey e2e).
  const label =
    dueSummary.dueCount > 0
      ? `${dueSummary.dueCount} card${dueSummary.dueCount === 1 ? "" : "s"} due, ~${dueSummary.estimatedMinutes} min`
      : dueSummary.newCount > 0
        ? `${dueSummary.newCount} card${dueSummary.newCount === 1 ? "" : "s"} ready to start, ~${dueSummary.estimatedMinutes} min`
        : "Nothing due today";
  const buttonLabel = dueSummary.dueCount > 0 || dueSummary.newCount > 0 ? "Start" : "Review anyway";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 text-left transition-colors hover:bg-accent/50"
      >
        <IconChip icon={BookOpen} accent="business" />
        <div className="flex-1">
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">Self-Mastery</div>
        </div>
        {/* A styled span, not a nested <button> -- the whole card above is
            already the single tap target (same discipline TaskRowList's
            own RemoveButton comment documents: a button inside a button is
            invalid HTML and the two clicks fight over the same target). */}
        <span
          aria-hidden
          className="rounded-lg border border-border bg-background px-2.5 py-1 text-sm font-medium"
        >
          {buttonLabel}
        </span>
      </button>
      <RetrievalSessionOverlay open={open} onClose={() => setOpen(false)} />
    </>
  );
}
