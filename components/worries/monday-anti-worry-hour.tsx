"use client";

import { Button } from "@/components/ui/button";
import type { Worry, WorryOutcome } from "@/lib/night-plan/worries";

const OUTCOME_OPTIONS: { value: WorryOutcome; label: string }[] = [
  { value: "resolved", label: "Resolved" },
  { value: "took_action", label: "Took action" },
  { value: "let_go", label: "Letting go" },
];

/**
 * P2-12 — the Monday Anti-Worry Hour: shown on top of the plain Worry List
 * only on Mondays (`app/(app)/worries/page.tsx` computes that server-side
 * via `localWeekday`/the user's own timezone, never a raw `Date` — AGENTS.md's
 * rule). A dedicated moment for working through open worries deliberately,
 * modeled on the classic CBT "worry time" technique: for each one, decide
 * whether it's no longer a real concern (`resolved`), got turned into a real
 * next step somewhere else in the app (`took_action`), or is being
 * consciously let go of for now (`let_go`) — three outcomes, not a bare
 * "Handled," because THAT is this panel's whole point (migration 201's own
 * header).
 *
 * Deliberately a plain list with three buttons per row, not a one-at-a-time
 * wizard: a wizard needs its own notion of "current position" independent
 * of the shared `worries` array (which shrinks under it as the parent
 * resolves items), and that bookkeeping bought nothing a real user needs —
 * "work through your worries" is satisfied by making a clear decision on
 * each visible row, in whatever order the user picks.
 */
export function MondayAntiWorryHour({
  worries,
  workedThrough,
  onOutcome,
}: {
  worries: Worry[];
  workedThrough: number;
  onOutcome: (worry: Worry, outcome: WorryOutcome) => void;
}) {
  // Nothing to show: no worries were ever open today AND none were worked
  // through this session — the plain Worry List below already covers the
  // "nothing on your mind" reassurance, so this panel just stays out of
  // the way rather than repeating it.
  if (worries.length === 0 && workedThrough === 0) return null;

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-6" data-panel>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Monday Anti-Worry Hour</p>
        {workedThrough > 0 ? (
          <p className="text-xs text-muted-foreground">
            {workedThrough} worked through today
          </p>
        ) : null}
      </div>

      {worries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Every open worry has an outcome. Nice.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {worries.length} open worr{worries.length === 1 ? "y" : "ies"} — pick what actually happened with each.
          </p>
          {/*
            reviewer-a3 finding (P2-12 stage 03, moved back from 03-in-review):
            this used to be a <ul>/<li> (implicit role="listitem"), which collided
            with worry-list.tsx's OWN open-worry <li> rendering the same title —
            two "listitem" matches for the same worry text while both are open
            (proven by worries-page-client.test.tsx's own "appears twice while
            open" assertion), which breaks e2e/worries.spec.ts's strict-mode
            `getByRole("listitem").filter({ hasText: title })` locator on any
            real Monday. This is a working SET of action cards, not a second nav
            list — plain <div>s carry no listitem role to collide with.
          */}
          <div className="mt-4 space-y-2">
            {worries.map((w) => (
              <div key={w.id} className="rounded-lg border border-border/40 p-3">
                <p className="text-sm">{w.title}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {OUTCOME_OPTIONS.map((opt) => (
                    <Button key={opt.value} size="sm" variant="outline" className="min-h-11" onClick={() => onOutcome(w, opt.value)}>
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
