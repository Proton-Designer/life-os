"use client";

import { refreshDistractionViews } from "@/app/(app)/distractions/actions";
import { useScheduleRefresh } from "@/lib/client/use-optimistic-item";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refresh = () => refreshDistractionViews();

/** ONE debounced refreshDistractionViews() per burst of distraction writes (PERF-4). */
export function useDistractionRefresh(): () => void {
  return useScheduleRefresh(refresh);
}
