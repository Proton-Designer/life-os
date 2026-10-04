"use client";

import { refreshSchoolViews } from "@/app/(app)/school/actions";
import { useScheduleRefresh } from "@/lib/client/use-optimistic-item";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshSchool = () => refreshSchoolViews();

/** ONE debounced refreshSchoolViews() per burst of school task taps (PERF-3). */
export function useScheduleSchoolRefresh(): () => void {
  return useScheduleRefresh(refreshSchool);
}
