"use client";

import { useCallback, useEffect, useState } from "react";
import { getAllocationQueueForNow, saveAllocationCheckin } from "@/app/(app)/checkin/allocation-actions";
import { AllocationCheckin } from "./allocation-checkin";
import type { Allocation, DomainKey } from "@/lib/checkins/allocation";

const POLL_MS = 60 * 1000;

type QueueItem = {
  windowStart: string;
  windowEnd: string;
  initialAllocation: Allocation;
  prefilled: Partial<Record<DomainKey, boolean>>;
};

function toPrefilledFlags(prefill: Allocation): Partial<Record<DomainKey, boolean>> {
  const flags: Partial<Record<DomainKey, boolean>> = {};
  for (const [domain, minutes] of Object.entries(prefill) as [DomainKey, number][]) {
    if (minutes > 0) flags[domain] = true;
  }
  return flags;
}

/**
 * Mounted in AppShell so it works from any screen — per the spec, push has
 * never delivered a single notification and 0/23 point-sample check-ins
 * were ever answered (the old CheckinSchedulerLoader was never even mounted
 * anywhere in the tree — see git history). "He opens the app and the queue
 * is right there" is the only mechanism with any real chance of working, so
 * this fetches on mount rather than waiting for an idle poll cycle to
 * surface the first item.
 *
 * Deliberately calls the saveAllocationCheckin/getAllocationQueueForNow
 * Server Actions directly (imported and invoked, not received as a prop
 * from a Server Component) — that side-steps the function-prop RSC
 * boundary entirely (AGENTS.md), same pattern CheckinScheduler already uses
 * for getCheckinOptionsForNow/recordMissedCheckin.
 */
export function AllocationCheckinGate() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [timezone, setTimezone] = useState("UTC");

  const refresh = useCallback(async () => {
    const result = await getAllocationQueueForNow(new Date().toISOString());
    setTimezone(result.timezone);
    setQueue(
      result.items.map((item) => ({
        windowStart: item.windowStartIso,
        windowEnd: item.windowEndIso,
        initialAllocation: item.prefill,
        prefilled: toPrefilledFlags(item.prefill),
      }))
    );
  }, []);

  useEffect(() => {
    // Fetch-on-mount then poll — the exact same shape as CheckinScheduler's
    // check()/POLL_MS pattern (components/checkin/checkin-scheduler.tsx),
    // which this lint rule does not flag; a minimal reproduction of that
    // file's own check() in isolation DOES get flagged, so this is a
    // react-compiler-analysis inconsistency tied to something about that
    // file's real imports, not a real synchronous-setState bug here — every
    // setState call below happens after an `await`, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  if (queue.length === 0) return null;
  const current = queue[0];

  async function handleSave(allocation: Allocation) {
    await saveAllocationCheckin(current.windowStart, current.windowEnd, allocation);
    setQueue((prev) => prev.slice(1));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Check-in"
    >
      <div className="w-full max-w-md rounded-t-2xl border border-border/40 bg-background p-4 shadow-lg sm:rounded-2xl">
        <AllocationCheckin
          windowStart={current.windowStart}
          windowEnd={current.windowEnd}
          timezone={timezone}
          initialAllocation={current.initialAllocation}
          prefilled={current.prefilled}
          queuePosition={queue.length > 1 ? { index: 1, total: queue.length } : undefined}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
