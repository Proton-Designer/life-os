"use client";

import { useState, useTransition } from "react";
import { CircleCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markWorryHandled, reopenWorry } from "@/app/(app)/worries/actions";
import type { Worry } from "@/lib/night-plan/worries";

/**
 * The Worry List (#42) — the first real reader `captureDump({source:"worry"})`
 * has ever had. Every worry captured through the Global Capture Sheet's Worry
 * button lands here, found by KIND (`dump_source='worry'`) rather than by
 * `planned_date` — see `lib/night-plan/worries.ts`'s header for why that
 * distinction is the whole bug.
 *
 * Server actions are IMPORTED here, not passed as props — the RSC
 * function-prop hazard AGENTS.md records; importing removes it rather than
 * testing for it.
 *
 * Optimistic locally, corrected by the server: a tap moves the row between
 * lists immediately (no spinner wait for a two-second ceremony), and rolls
 * back with the server's error if the write actually failed.
 */
export function WorryList({ open, handled }: { open: Worry[]; handled: Worry[] }) {
  const [openWorries, setOpenWorries] = useState(open);
  const [handledWorries, setHandledWorries] = useState(handled);
  const [showHandled, setShowHandled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handle(worry: Worry) {
    setError(null);
    setOpenWorries((prev) => prev.filter((w) => w.id !== worry.id));
    setHandledWorries((prev) => [{ ...worry, completed: true, completedAt: new Date().toISOString() }, ...prev]);
    startTransition(async () => {
      const res = await markWorryHandled(worry.id);
      if ("error" in res) {
        setError(res.error);
        // Roll back: the row didn't actually move.
        setHandledWorries((prev) => prev.filter((w) => w.id !== worry.id));
        setOpenWorries((prev) => [...prev, worry].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      }
    });
  }

  function reopen(worry: Worry) {
    setError(null);
    setHandledWorries((prev) => prev.filter((w) => w.id !== worry.id));
    setOpenWorries((prev) => [...prev, { ...worry, completed: false, completedAt: null }]);
    startTransition(async () => {
      const res = await reopenWorry(worry.id);
      if ("error" in res) {
        setError(res.error);
        setOpenWorries((prev) => prev.filter((w) => w.id !== worry.id));
        setHandledWorries((prev) => [worry, ...prev]);
      }
    });
  }

  const hasAny = openWorries.length > 0 || handledWorries.length > 0;

  if (!hasAny) {
    // A REAL DESIGN PROBLEM, PER SPEC: "no worries" must read as reassuring,
    // not as a broken/empty screen. No action is offered — there is nothing
    // to do here, and offering one ("capture a worry?") would undercut the
    // reassurance by implying an empty list is incomplete.
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/40 bg-card py-12 text-center">
        <CircleCheck className="size-8 text-accent-business" strokeWidth={1.5} />
        <p className="text-sm font-medium">Nothing on your mind right now.</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Worries you park from the capture sheet show up here until you mark them handled.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {openWorries.length === 0 ? (
        <div className="rounded-2xl border border-border/40 bg-card p-6 text-center">
          <CircleCheck className="mx-auto size-6 text-accent-business" strokeWidth={1.5} />
          <p className="mt-2 text-sm">Everything's handled.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {openWorries.map((w) => (
            <li key={w.id} className="flex items-center gap-3 rounded-lg border border-border/40 bg-card p-3">
              <span className="flex-1 text-sm">{w.title}</span>
              <Button size="sm" variant="outline" onClick={() => handle(w)}>
                <CircleCheck className="size-4" aria-hidden />
                Handled
              </Button>
            </li>
          ))}
        </ul>
      )}

      {handledWorries.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowHandled((v) => !v)}
            className="text-xs font-medium text-muted-foreground underline underline-offset-4"
          >
            {showHandled ? "Hide" : "Show"} {handledWorries.length} handled
          </button>
          {showHandled ? (
            <ul className="mt-2 space-y-2">
              {handledWorries.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-3 rounded-lg border border-border/20 bg-card/60 p-3 text-muted-foreground"
                >
                  <span className="flex-1 text-sm line-through decoration-muted-foreground/50">{w.title}</span>
                  <Button size="sm" variant="ghost" onClick={() => reopen(w)}>
                    <Undo2 className="size-4" aria-hidden />
                    Reopen
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
