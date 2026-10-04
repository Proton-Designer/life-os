"use client";

import { refreshDeenViews } from "@/app/(app)/deen/actions";
import {
  useOptimisticItem as useGenericOptimisticItem,
  useScheduleRefresh as useGenericScheduleRefresh,
} from "@/lib/client/use-optimistic-item";

// Lazy on purpose: the action is only touched when the debounced refresh fires.
const refreshDeen = () => refreshDeenViews();

/**
 * Deen binding of the generic hook in lib/client/use-optimistic-item.ts: the data-free
 * refresh is `refreshDeenViews` (revalidates /deen, Home and the domains-mode faith route).
 */
export function useScheduleRefresh(): () => void {
  return useGenericScheduleRefresh(refreshDeen);
}

export function useOptimisticItem<T>(opts: Omit<Parameters<typeof useGenericOptimisticItem<T>>[0], "refresh">) {
  return useGenericOptimisticItem<T>({ ...opts, refresh: refreshDeen });
}
