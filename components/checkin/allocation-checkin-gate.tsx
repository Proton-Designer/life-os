"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveAllocationCheckin } from "@/app/(app)/checkin/allocation-actions";
import { useAllocationQueue, type AllocationQueueItem } from "@/lib/checkins/allocation-queue-context";
import { AllocationCheckin } from "./allocation-checkin";
import { NotificationPermissionNudge } from "./notification-permission-nudge";
import { TOTAL_MINUTES, emptyAllocation, type Allocation } from "@/lib/checkins/allocation";

/**
 * The sheet half of the check-in queue UI — the badge half lives in shell
 * chrome (Engineer 2). Both read the same AllocationQueueProvider (one
 * poll, not two) via useAllocationQueue(); the badge calls setOpen(true),
 * this renders what opens.
 *
 * "Unmissable" is the goal, but NOT "inescapable": opening this sheet, and
 * leaving it, are both the user's action — never automatic. 2026-08-19
 * review history: v1 auto-opened a hand-rolled inescapable `fixed inset-0`
 * overlay the instant the queue was non-empty, with no close control, no
 * Escape handler, no focus trap despite claiming `aria-modal="true"`. v2
 * fixed the escape hatch but kept the auto-open — still wrong, because a
 * large queue (exactly what accumulates right after a stretch of not
 * opening the app — Engineer 2 hit 6 queued items live) still forced
 * completing everything before reaching Home. The failure in both: when
 * "Done" is the only way out, a person who wants past it taps Done without
 * editing — reintroducing, through the interaction, the exact
 * rubber-stamped data this build spent an hour removing from pre-fill.
 *
 * Deliberately calls saveAllocationCheckin directly (imported and invoked
 * from client code, not received as a prop from a Server Component) — that
 * side-steps the function-prop RSC boundary entirely (AGENTS.md), same
 * pattern CheckinScheduler already uses for getCheckinOptionsForNow.
 */
export function AllocationCheckinGate() {
  const { queue, timezone, total, open, setOpen, completeCurrent, mostRecentUnanswered } = useAllocationQueue();

  // Ayman, verbatim (batch 3, B3-1): "keep it available whenever" — pressing
  // the icon must ALWAYS open a real, saveable check-in, never a silent
  // no-op (that silence is exactly what this item was reported to fix in
  // the first place). Three tiers, most-specific first:
  //   1. queue[0]              — a window fired within the answer window.
  //   2. mostRecentUnanswered  — a window fired today but the answer window
  //      lapsed; still a REAL window (see its own doc comment for why
  //      answering it needs no "un-expire" step).
  //   3. an ad-hoc window ending right now — there is no real window at
  //      all today (e.g. before checkin_window_start, or everything
  //      already answered). `useMemo(..., [open])` freezes "now" at the
  //      instant the sheet opens rather than re-deriving on every render
  //      while it's open. Schema-safe: window_start/window_end are
  //      nullable, but checkin_time = window_end is NOT NULL, so this still
  //      needs real timestamps — a 120-minute (TOTAL_MINUTES) window ending
  //      now matches the size the allocation bar already assumes.
  const adHocWindow = useMemo<AllocationQueueItem>(() => {
    const end = new Date();
    const start = new Date(end.getTime() - TOTAL_MINUTES * 60 * 1000);
    return {
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      initialAllocation: emptyAllocation(),
      prefilled: {},
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately re-derived only when the sheet opens, not on every render while it's open
  }, [open]);
  const current = queue[0] ?? mostRecentUnanswered ?? adHocWindow;

  async function handleSave(allocation: Allocation) {
    await saveAllocationCheckin(current.windowStart, current.windowEnd, allocation);
    completeCurrent();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check-in</DialogTitle>
        </DialogHeader>
        <NotificationPermissionNudge />
        <AllocationCheckin
          windowStart={current.windowStart}
          windowEnd={current.windowEnd}
          timezone={timezone}
          initialAllocation={current.initialAllocation}
          prefilled={current.prefilled}
          queuePosition={total > 1 ? { index: total - queue.length + 1, total } : undefined}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}
