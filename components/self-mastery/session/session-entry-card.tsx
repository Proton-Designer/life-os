"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  selfMasteryHref = "/self-mastery",
}: {
  dueSummary: { dueCount: number; newCount: number; estimatedMinutes: number; hasBooks: boolean } | null;
  /** Where the "Add a book" banner below sends a user with an empty library.
   * A domains-mode account keeping Self-Mastery belongs at /personal/self_mastery
   * (the four-tab Personal shell); everyone else falls back to the standalone
   * legacy page, which is the only Self-Mastery entry a legacy account has. */
  selfMasteryHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (!dueSummary) return null;

  // ONB item 11: a genuinely empty library (never added a book) gets its
  // own honest state, deliberately separate from "Nothing due today" below
  // -- that copy is for an EXISTING book with nothing currently due, not a
  // stand-in for "no book was ever added." This used to be a "Your starter
  // deck didn't load" retry (Boss ruling R7) for the automatic Marcus
  // Aurelius seed onboarding used to create; that seed no longer runs (a
  // new account showing 47 cards from nowhere was itself the bug Ayman
  // reported), so zero books is never a failure signal now -- just point
  // at the library.
  if (!dueSummary.hasBooks) {
    return (
      <button
        type="button"
        onClick={() => router.push(selfMasteryHref)}
        className="flex w-full items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 text-left transition-colors hover:bg-accent/50"
      >
        <IconChip icon={BookOpen} accent="business" />
        <div className="flex-1">
          <div className="text-sm font-medium">Add a book to get started</div>
          <div className="text-xs text-muted-foreground">Self-Mastery</div>
        </div>
        <span
          aria-hidden
          className="rounded-lg border border-border bg-background px-2.5 py-1 text-sm font-medium"
        >
          Add book
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
