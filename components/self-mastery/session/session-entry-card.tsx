"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { RetrievalSessionOverlay } from "./retrieval-session-overlay";

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
  dueSummary: { dueCount: number; estimatedMinutes: number } | null;
}) {
  const [open, setOpen] = useState(false);

  if (!dueSummary) return null;

  const label =
    dueSummary.dueCount > 0
      ? `${dueSummary.dueCount} card${dueSummary.dueCount === 1 ? "" : "s"} due, ~${dueSummary.estimatedMinutes} min`
      : "Nothing due today";

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
          {dueSummary.dueCount > 0 ? "Start" : "Review anyway"}
        </span>
      </button>
      <RetrievalSessionOverlay open={open} onClose={() => setOpen(false)} />
    </>
  );
}
