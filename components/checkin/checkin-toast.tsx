"use client";

// The in-app half of "a check-in just fired" (desktop half lives in
// allocation-queue-context.tsx's notifyDesktop). Auto-dismisses on its own
// (TOAST_MS in the context) — this component only renders whatever the
// context currently holds and offers two ways to end it early: tap it to
// open the sheet, or tap the dismiss control to just clear it.

import { useAllocationQueue } from "@/lib/checkins/allocation-queue-context";

export function CheckinToast() {
  const { toast, setOpen, dismissToast } = useAllocationQueue();

  if (!toast) return null;

  const label = toast.newCount === 1 ? "Check-in available" : `${toast.newCount} check-ins available`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-lg border border-border/40 bg-background px-4 py-3 shadow-lg lg:left-auto lg:right-4 lg:inset-x-auto"
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
