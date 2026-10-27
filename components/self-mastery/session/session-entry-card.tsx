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
  dueSummary: {
    dueCount: number;
    newCount: number;
    sessionDueCount: number;
    sessionNewCount: number;
    newAllowanceSpent: boolean;
    estimatedMinutes: number;
    hasBooks: boolean;
  } | null;
}) {
  const [open, setOpen] = useState(false);

  if (!dueSummary) return null;

  // A genuinely empty library (never added a book) shows NOTHING on Home: the "Add a book to get started"
  // banner was removed on request (Ayman, 2026-10-04). Self-Mastery stays reachable from the nav; this is
  // deliberately separate from "Nothing due today" below, which is for an EXISTING book with nothing
  // currently due. (Zero books is also never a failure signal: onboarding no longer seeds a starter deck.)
  if (!dueSummary.hasBooks) return null;

  // Three genuinely different states, not two -- "due" (real review debt),
  // "new cards to start" (a fresh/seeded deck nobody's touched yet, dueCount=0
  // for an honest reason, not because there's nothing to do), and actually
  // caught up. Collapsing the second into "Nothing due today" reads as broken
  // on day one (Opus Lead, stranger-journey e2e).
  //
  // The counts shown are what the session will TAKE (sessionDueCount /
  // sessionNewCount), not the library's: after one book there are 222 new
  // cards, but a session holds only user_settings.daily_new_limit of them, so
  // "222 cards ready, ~8 min" was false twice over. The rest is a quiet
  // "more waiting" note. The new-card cap is per DAY (cards already started
  // today come off it), so "today" is honest here: new-only reads "5 new cards
  // today", and once the allowance is spent with nothing due it says "Done for
  // today" instead of the caught-up "Nothing due today".
  const { sessionDueCount: due, sessionNewCount: fresh } = dueSummary;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const min = `~${dueSummary.estimatedMinutes} min`;
  const label =
    due > 0 && fresh > 0
      ? `${due} due + ${fresh} new, ${min}`
      : due > 0
        ? `${plural(due, "card")} due, ${min}`
        : fresh > 0
          ? `${plural(fresh, "new card")} today, ${min}`
          : dueSummary.newAllowanceSpent
            ? "Done for today"
            : "Nothing due today";
  const waiting = dueSummary.dueCount - due + (dueSummary.newCount - fresh);
  const buttonLabel = due > 0 || fresh > 0 ? "Start" : "Review anyway";

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
          <div className="text-xs text-muted-foreground">{waiting > 0 ? `Self-Mastery · ${waiting} ${dueSummary.newAllowanceSpent && due === 0 ? "new waiting" : "more waiting"}` : "Self-Mastery"}</div>
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
