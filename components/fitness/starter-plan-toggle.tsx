"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * The starter plan (30 pull-ups/100 push-ups, spec §5) is NOT a peer of
 * the three session plans below — it's two standing daily rep goals,
 * orthogonal to the schedule, and per spec §8.3 it should run 2-4 weeks
 * BEFORE any session plan rather than instead of one. Presenting it as a
 * fourth card alongside Plans A/B/C would frame it as an alternative,
 * which is the wrong mental model (Opus Lead, 2026-08-20) — so this is
 * visually distinct, worded as an addition ("stacks with a session
 * plan"), and reachable independently at any time, not only at first run,
 * since the recommended path is adopting it alone first and a session
 * plan later.
 */
export function StarterPlanToggle({
  adopted,
  onAdopt,
}: {
  adopted: boolean;
  onAdopt: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  if (adopted) {
    return (
      <div
        data-testid="starter-plan-adopted"
        className="flex items-center justify-between gap-2 rounded-lg border border-accent-fitness/40 bg-accent-fitness/10 px-3 py-2 text-sm"
      >
        <span>Daily rep target active — 30 pull-ups, 100 push-ups, weekdays.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border/60 px-3 py-2.5">
      <p className="text-sm font-medium">Start with a daily pull-up and push-up target</p>
      <p className="text-xs text-muted-foreground">
        30 pull-ups, 100 push-ups, chipped away through the weekday — stacks with a session plan, doesn&apos;t
        replace one.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() => startTransition(onAdopt)}
        className="min-h-11 w-fit"
      >
        Start this
      </Button>
    </div>
  );
}
