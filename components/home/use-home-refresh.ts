"use client";

import { refreshHome } from "@/app/(app)/actions";
import { useScheduleRefresh } from "@/lib/client/use-optimistic-item";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refresh = () => refreshHome();

/** ONE debounced refreshHome() per burst of Home taps (PERF-2) -- replaces the per-tap revalidatePath("/"). */
export function useHomeRefresh(): () => void {
  return useScheduleRefresh(refresh);
}
