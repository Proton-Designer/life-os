"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveAllocationCheckin } from "@/app/(app)/checkin/allocation-actions";
import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";
import { AllocationCheckin } from "./allocation-checkin";
import { NotificationPermissionNudge } from "./notification-permission-nudge";
import type { Allocation } from "@/lib/checkins/allocation";

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
  // "Check in whenever you want" (batch 3, B3-1): once the polled queue is
  // empty (the 30-minute answer window on every fired slot has almost
  // certainly lapsed by the time someone manually opens this), fall back to
  // the most recent unanswered window rather than showing nothing. Answering
  // it is ordinary saveAllocationCheckin on its own bounds — see
  // mostRecentUnanswered's own doc comment in get-allocation-queue.ts for why
  // there's no separate "un-expire" step needed.
  const current = queue[0] ?? mostRecentUnanswered;

  async function handleSave(allocation: Allocation) {
    if (!current) return;
    await saveAllocationCheckin(current.windowStart, current.windowEnd, allocation);
    completeCurrent();
  }

  if (!current) return null;

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
