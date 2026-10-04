"use client";

// The overlay's own presentation of a pending allocation check-in (146,
// Phase 5 — Ayman: check-ins "should be visible in the expanded view").
// Reads useAllocationQueue() directly, the SAME context the sheet
// (AllocationCheckinGate) and the toast (CheckinToast) already read — one
// source of truth, no overlay-local copy of the queue that could drift.
// Answering it calls saveAllocationCheckin directly (imported, not passed
// as a prop — sidesteps the RSC function-prop boundary the same way
// AllocationCheckinGate's own comment explains) and completeCurrent() from
// the context, the exact same two calls the sheet's handleSave makes.
//
// ONLY the real, scheduler-fired queue — never AllocationCheckinGate's own
// ad-hoc "check in whenever" fallback (mostRecentUnanswered / a synthetic
// window ending now). That fallback exists for tapping the badge icon when
// nothing is actually pending; showing it unprompted inside a Lock-In
// session would manufacture a check-in that was never scheduled.

import { saveAllocationCheckin } from "@/app/(app)/checkin/allocation-actions";
import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";
import { AllocationCheckin } from "@/components/checkin/allocation-checkin";
import type { Allocation } from "@/lib/checkins/allocation";

export function LockInCheckin({ className }: { className?: string }) {
  const { queue, timezone, deenMode, total, completeCurrent } = useAllocationQueue();
  const current = queue[0];
  if (!current) return null;

  async function handleSave(allocation: Allocation) {
    await saveAllocationCheckin(current!.windowStart, current!.windowEnd, allocation);
    completeCurrent();
  }

  return (
    <div className={className}>
      <div className="w-full rounded-lg border border-foreground/20 bg-background/95 p-4 text-foreground shadow-lg">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Check-in
        </p>
        <AllocationCheckin
          windowStart={current.windowStart}
          windowEnd={current.windowEnd}
          timezone={timezone}
          initialAllocation={current.initialAllocation}
          prefilled={current.prefilled}
          queuePosition={total > 1 ? { index: total - queue.length + 1, total } : undefined}
          showDeen={deenMode}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
