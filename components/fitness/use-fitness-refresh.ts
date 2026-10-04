"use client";

import { refreshFitnessViews } from "@/app/(app)/fitness/actions";
import { useScheduleRefresh } from "@/lib/client/use-optimistic-item";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshFitness = () => refreshFitnessViews();

/**
 * Fitness binding of the shared deferred refresh (PERF-3): call the returned
 * function after a log/confirm write lands. One debounced `refreshFitnessViews`
 * (revalidates /fitness, Home and the domains-mode area route) runs per burst.
 */
export function useScheduleFitnessRefresh(): () => void {
  return useScheduleRefresh(refreshFitness);
}
