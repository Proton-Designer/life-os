"use client";

import { useState } from "react";
import { SessionDetailPanel, type ConfirmSet } from "./session-detail-panel";
import type { DayWorkout } from "@/lib/fitness/load-workout-details";

/**
 * Home's on-plan confirm (spec §3.1, corrected by the Lead 2026-08-20 after
 * finding §3.1 and §2.1 in conflict: "one-tap confirm" can't also be "no
 * bare Confirm with numbers hidden"). Collapsed by default — quiet, one
 * line, must not out-shout Deen or Business on a six-domain dashboard —
 * and expands in place to the exact same SessionDetailPanel the Fitness
 * page uses, so there is exactly one confirm UI and one write path (RPC
 * 029 via confirmWorkoutSession), never a second one to drift from.
 *
 * Renders nothing when there's no assigned workout today (including
 * week-one's starter-plan-only case) or once already confirmed — nothing
 * left to do, so nothing left to show.
 */
export function HomeOnPlanCard({
  date,
  workout,
  alreadyConfirmed,
  onConfirm,
}: {
  date: string;
  workout: DayWorkout | null;
  alreadyConfirmed: boolean;
  onConfirm: (date: string, workoutId: string, workoutName: string, sets: ConfirmSet[]) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!workout || alreadyConfirmed) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        data-testid="home-on-plan-collapsed"
        className="min-h-11 flex w-full items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-left text-sm"
      >
        <span className="font-medium">{workout.name}</span>
        <span className="text-xs text-muted-foreground">Not logged yet</span>
      </button>
    );
  }

  return (
    <div data-testid="home-on-plan-expanded">
      <SessionDetailPanel date={date} dayLabel="Today" workout={workout} alreadyConfirmed={false} onConfirm={onConfirm} />
    </div>
  );
}
