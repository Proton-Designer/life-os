"use client";

import { CircleCheck } from "lucide-react";
import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";
import { cn } from "@/lib/utils";

/**
 * The topbar's permanently-visible Check-in icon (batch 3, B3-1). Ayman:
 * "add in that icon permanently visible in the top right" — replaces the
 * old CheckinQueueBadge (removed 2026-08-20 for rendering 25% of the day;
 * see notifications-bell.tsx's own header), which folded the check-in into
 * the bell instead. This is a second, deliberate surface Ayman explicitly
 * asked back for — no gating: pressing it always opens
 * AllocationCheckinGate (falls back to `mostRecentUnanswered` once the
 * polled queue is empty, so "check in whenever" never shows a dead form).
 * Glows/radiates only while a window is genuinely pending — the same 2h
 * cadence Ayman described, not a separate timer (see .checkin-icon.is-pending
 * in globals.css, which itself respects prefers-reduced-motion).
 */
export function CheckInIconButton() {
  const { queue, setOpen } = useAllocationQueue();
  const pending = queue.length > 0;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      // "Open check-in" — deliberately distinct from NotificationsBell's
      // own folded-in "Check-in" item AND CheckinToast's "Check-in
      // available — what did you just do?" button, both rendered on this
      // same page. Same accessible-name collision class C caught in the
      // habit editor tonight ("Advanced" -> "Edit history") and B caught on
      // School's KPI strip ("Completed" -> "Completed tasks"). The glow
      // itself (not the label) communicates "something's pending."
      aria-label="Open check-in"
      className={cn(
        // size-9 below sm (still clears the 40px touch-target floor once
        // the button's own padding/border are counted), size-11 at sm+ —
        // 320px-wide phones don't have room for the full size (layout-
        // overflow.spec.ts, batch 3 verification).
        "checkin-icon flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground sm:size-11",
        pending && "is-pending text-foreground"
      )}
    >
      <CircleCheck className="size-4" />
    </button>
  );
}
