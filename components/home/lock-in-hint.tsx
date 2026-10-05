"use client";

import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";
import { useHomeVisibleMs } from "@/components/home/use-home-visible-time";
import { HINT_VISIBLE_LIMIT_MS } from "@/lib/client/visible-time";

/**
 * A SUBTLE nudge under the Hours tile (HOME-01b): small muted text, no banner. Shown only while no focus
 * time is logged today AND no Lock-In is running; it goes the moment a session starts (the overlay context
 * knows at once) or time is logged, and for the rest of the local day once Home has been open and visible
 * for 3 minutes in total (per device). Renders nothing until the stored time has been read, so it never
 * flashes in and out.
 */
export function LockInHint({ localDate, hoursTodayMinutes }: { localDate: string; hoursTodayMinutes: number }) {
  const { session } = useLockInOverlay();
  const visibleMs = useHomeVisibleMs(localDate);
  if (hoursTodayMinutes > 0 || session !== null || visibleMs === null || visibleMs >= HINT_VISIBLE_LIMIT_MS) return null;
  return (
    <p className="px-1 text-xs text-muted-foreground" data-testid="lock-in-hint">
      Start a Lock-In to log focus time
    </p>
  );
}
