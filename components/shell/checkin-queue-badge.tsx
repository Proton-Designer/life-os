"use client";

// The only entry point to the check-in queue now that the sheet
// (allocation-checkin-gate.tsx) never auto-opens — see the 2026-08-19
// checkin-allocation-system build. Discoverability is this component's
// whole job, but it sits beside real navigation, so it stays a small
// count indicator rather than a second thing competing for attention:
// neutral icon color, an info-accent (never destructive) numeric dot,
// no motion, no auto-popping. If it's not being tapped, the fix is a
// bigger dot, not turning it into another modal.

import { ListChecks } from "lucide-react";
import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";

export function CheckinQueueBadge() {
  const { queue, setOpen } = useAllocationQueue();
  const count = queue.length;

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`${count} check-in${count === 1 ? "" : "s"} waiting`}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
    >
      <ListChecks className="size-5" />
      <span
        aria-hidden
        className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent-info px-1 text-[10px] font-semibold leading-none text-background"
      >
        {count}
      </span>
    </button>
  );
}
