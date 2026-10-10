"use client";

// The in-app half of "a check-in just fired" (desktop half lives in
// allocation-queue-context.tsx's notifyDesktop). Auto-dismisses on its own
// (TOAST_AUTO_DISMISS_MS in the context, 5 minutes as of Phase 5) — this
// component only renders whatever the context currently holds and offers
// two ways to end it early: tap it to open the sheet, or tap the dismiss
// control to just clear it.

import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";

export function CheckinToast() {
  const { toast, setOpen, dismissToast } = useAllocationQueue();
  // Never shown during a Deep Work / Deep Study session, expanded or minimized: a session is not interrupted by a
  // check-in (its minutes account for themselves, lib/checkins/session-accounting.ts). Once the session ends the
  // check-in is still there to answer.
  const { session } = useLockInOverlay();

  if (!toast || session) return null;

  const label = toast.newCount === 1 ? "Check-in available" : `${toast.newCount} check-ins available`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="checkin-toast"
      // Right-side slide-in on BOTH mobile and desktop (Ayman: "a subtle
      // popup from the right") — was inset-x-3/centered on mobile, right-
      // aligned only on desktop; now right-anchored at every width, just
      // narrower on mobile via the calc() so it never touches the left
      // edge. "Subtle" is the reduced shadow/border-only card look plus a
      // short, ease-out slide rather than a bouncy entrance — this fires
      // mid-focus-session, so an attention-grabbing animation would be the
      // opposite of the point. motion-reduce disables the slide entirely,
      // same convention as step-shell.tsx's own entrance animation.
      className="fixed right-3 top-3 z-50 flex w-[calc(100%-1.5rem)] max-w-sm items-center gap-3 rounded-lg border border-border/40 bg-background px-4 py-3 shadow-md sm:right-4 animate-in fade-in slide-in-from-right-8 duration-300 ease-out motion-reduce:animate-none motion-reduce:slide-in-from-right-0"
    >
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          dismissToast();
        }}
        className="flex min-h-11 flex-1 items-center text-left text-sm font-medium"
      >
        {label} — what did you just do?
      </button>
      <button
        type="button"
        onClick={dismissToast}
        aria-label="Dismiss"
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground"
      >
        ×
      </button>
    </div>
  );
}
