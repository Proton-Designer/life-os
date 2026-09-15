"use client";

import { useState, useTransition } from "react";
import { markWorryHandled, reopenWorry, recordWorryOutcome } from "@/app/(app)/worries/actions";
import type { Worry, WorryOutcome } from "@/lib/night-plan/worries";
import { WorryList } from "./worry-list";
import { MondayAntiWorryHour } from "./monday-anti-worry-hour";

/**
 * Owns the Worry List's shared, mutable state (P2-12) — split out of
 * `worry-list.tsx` itself once the Monday Anti-Worry Hour panel needed to
 * mutate the SAME `open`/`handled` arrays that list renders: two
 * independent `useState`s (one per component) would let a worry resolved
 * from the panel keep showing in the plain list below until a full reload,
 * since a Server Component re-render passing fresh props does not reset an
 * already-mounted client component's `useState` (only its OWN first-mount
 * value). One owner, passed down as props + callbacks, same shape
 * `worry-list.tsx` used to have internally — just one level up now.
 *
 * Server actions are imported HERE (the owner), never passed down as bound
 * functions to children — the RSC function-prop hazard AGENTS.md records,
 * side-stepped by import rather than by prop.
 */
export function WorriesPageClient({
  open,
  handled,
  isMonday,
}: {
  open: Worry[];
  handled: Worry[];
  isMonday: boolean;
}) {
  const [openWorries, setOpenWorries] = useState(open);
  const [handledWorries, setHandledWorries] = useState(handled);
  const [mondayResolvedCount, setMondayResolvedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** `outcome` present = the Monday panel's action (recordWorryOutcome); absent = the plain list's "Handled" tap (markWorryHandled, outcome stays null) — same optimistic-then-corrected shape either way. */
  function handle(worry: Worry, outcome?: WorryOutcome) {
    setError(null);
    setOpenWorries((prev) => prev.filter((w) => w.id !== worry.id));
    setHandledWorries((prev) => [{ ...worry, completed: true, completedAt: new Date().toISOString(), outcome: outcome ?? null }, ...prev]);
    if (outcome) setMondayResolvedCount((n) => n + 1);
    startTransition(async () => {
      const res = outcome ? await recordWorryOutcome(worry.id, outcome) : await markWorryHandled(worry.id);
      if ("error" in res) {
        setError(res.error);
        // Roll back: the row didn't actually move.
        setHandledWorries((prev) => prev.filter((w) => w.id !== worry.id));
        setOpenWorries((prev) => [...prev, worry].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        if (outcome) setMondayResolvedCount((n) => Math.max(0, n - 1));
      }
    });
  }

  function reopen(worry: Worry) {
    setError(null);
    setHandledWorries((prev) => prev.filter((w) => w.id !== worry.id));
    setOpenWorries((prev) => [...prev, { ...worry, completed: false, completedAt: null, outcome: null }]);
    startTransition(async () => {
      const res = await reopenWorry(worry.id);
      if ("error" in res) {
        setError(res.error);
        setOpenWorries((prev) => prev.filter((w) => w.id !== worry.id));
        setHandledWorries((prev) => [worry, ...prev]);
      }
    });
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {isMonday ? (
        <MondayAntiWorryHour worries={openWorries} workedThrough={mondayResolvedCount} onOutcome={(w, outcome) => handle(w, outcome)} />
      ) : null}
      <WorryList open={openWorries} handled={handledWorries} onHandle={(w) => handle(w)} onReopen={reopen} />
    </div>
  );
}
