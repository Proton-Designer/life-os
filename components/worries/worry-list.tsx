"use client";

import { useState } from "react";
import { CircleCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Worry } from "@/lib/night-plan/worries";

/** P2-12: outcome label shown next to a handled worry that has one (recorded via the Monday Anti-Worry Hour panel) — a plain "Handled" tap from the list below never sets one. */
const OUTCOME_LABEL: Record<string, string> = {
  resolved: "Resolved",
  took_action: "Took action",
  let_go: "Let it go",
};

/**
 * The Worry List (#42) — the first real reader `captureDump({source:"worry"})`
 * has ever had. Every worry captured through the Global Capture Sheet's Worry
 * button lands here, found by KIND (`dump_source='worry'`) rather than by
 * `planned_date` — see `lib/night-plan/worries.ts`'s header for why that
 * distinction is the whole bug.
 *
 * PURELY PRESENTATIONAL as of P2-12 for `open`/`handled` themselves: the
 * parent (`worries-page-client.tsx`) owns that state and the mutating
 * handlers, not this component — the Monday Anti-Worry Hour panel above it
 * needs to mutate the SAME list (so resolving a worry there removes it from
 * here too, in the same tick, no page reload), which means exactly one
 * component can own that state. `showHandled` stays LOCAL here — purely a
 * display toggle, nothing else reads or depends on it.
 */
export function WorryList({
  open,
  handled,
  onHandle,
  onReopen,
}: {
  open: Worry[];
  handled: Worry[];
  onHandle: (worry: Worry) => void;
  onReopen: (worry: Worry) => void;
}) {
  const [showHandled, setShowHandled] = useState(false);
  const hasAny = open.length > 0 || handled.length > 0;

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
      {open.length === 0 ? (
        <div className="rounded-2xl border border-border/40 bg-card p-6 text-center">
          <CircleCheck className="mx-auto size-6 text-accent-business" strokeWidth={1.5} />
          <p className="mt-2 text-sm">Everything's handled.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {open.map((w) => (
            <li key={w.id} className="flex items-center gap-3 rounded-lg border border-border/40 bg-card p-3">
              <span className="flex-1 text-sm">{w.title}</span>
              <Button size="sm" variant="outline" onClick={() => onHandle(w)}>
                <CircleCheck className="size-4" aria-hidden />
                Handled
              </Button>
            </li>
          ))}
        </ul>
      )}

      {handled.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowHandled((v) => !v)}
            className="text-xs font-medium text-muted-foreground underline underline-offset-4"
          >
            {showHandled ? "Hide" : "Show"} {handled.length} handled
          </button>
          {showHandled ? (
            <ul className="mt-2 space-y-2">
              {handled.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-3 rounded-lg border border-border/20 bg-card/60 p-3 text-muted-foreground"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm line-through decoration-muted-foreground/50">{w.title}</span>
                    {w.outcome ? <span className="text-[11px]">{OUTCOME_LABEL[w.outcome] ?? w.outcome}</span> : null}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => onReopen(w)}>
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
