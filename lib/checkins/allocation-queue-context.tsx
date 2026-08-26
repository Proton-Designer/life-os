"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getAllocationQueueForNow } from "@/app/(app)/checkin/allocation-actions";
import type { Allocation, DomainKey } from "./allocation";

const POLL_MS = 60 * 1000;

/** How long the in-app toast stays up before auto-dismissing itself. */
const TOAST_MS = 8_000;

export type AllocationQueueItem = {
  windowStart: string;
  windowEnd: string;
  initialAllocation: Allocation;
  prefilled: Partial<Record<DomainKey, boolean>>;
};

type AllocationQueueContextValue = {
  queue: AllocationQueueItem[];
  timezone: string;
  /** "N of total" tracking across polls — only grows when genuinely new windows fire, resets once the queue clears. See allocation-checkin-gate.tsx. */
  total: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Removes the completed item locally (no extra fetch) and closes the sheet if nothing's left. */
  completeCurrent: () => void;
  /** The most recently fired window(s) this poll cycle detected as newly answerable — drives the in-app toast (checkin-toast.tsx). Null once dismissed or auto-expired. */
  toast: { item: AllocationQueueItem; newCount: number } | null;
  dismissToast: () => void;
  /**
   * The fallback item for "check in whenever you want" (batch 3, B3-1) —
   * the most recent today's window that's neither answered nor upcoming,
   * used only when `queue` is empty (see allocation-checkin-gate.tsx's
   * `current = queue[0] ?? mostRecentUnanswered`). Null once nothing today
   * qualifies (e.g. everything's already answered, or the day just started).
   */
  mostRecentUnanswered: AllocationQueueItem | null;
};

const AllocationQueueContext = createContext<AllocationQueueContextValue | null>(null);

function toPrefilledFlags(prefill: Allocation): Partial<Record<DomainKey, boolean>> {
  const flags: Partial<Record<DomainKey, boolean>> = {};
  for (const [domain, minutes] of Object.entries(prefill) as [DomainKey, number][]) {
    if (minutes > 0) flags[domain] = true;
  }
  return flags;
}

/**
 * Fires a desktop notification for newly-answerable window(s), if and only
 * if permission is already granted — this never itself prompts (that's
 * NotificationSettings/subscribeToPush's job, triggered by an explicit user
 * action). Silently no-ops anywhere the Notification API is unavailable
 * (SSR, unsupported browser) rather than throwing.
 */
function notifyDesktop(newCount: number) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(newCount === 1 ? "Check-in available" : `${newCount} check-ins available`, {
      body: "What did you just do?",
      tag: "allocation-checkin",
    });
  } catch {
    // Some browsers (notably iOS Safari outside a service-worker context)
    // throw synchronously on `new Notification(...)` even when permission
    // reads "granted" — the in-app toast covers this device regardless.
  }
}

/**
 * Single source of truth for the pending allocation check-in queue, shared
 * between the badge (Engineer 2, shell chrome) and the sheet (this file's
 * AllocationCheckinGate) — one poll instead of two independent ones hitting
 * the DB every 60s. Mount once, high in AppShell.
 *
 * Also owns the "a check-in just fired" notification (desktop + in-app
 * toast, checkin-toast.tsx) — detected here, not in a separate effect,
 * because this is the one place that already knows the queue's previous
 * shape each poll. `seenWindowStartsRef` tracks every window start this
 * provider has ever shown a toast/notification for (not just the current
 * queue) so re-polling doesn't re-notify for a window that's still pending
 * from an earlier cycle.
 *
 * The first load notifies too, same as any later poll — it does NOT seed
 * a silent baseline. That silent-baseline behavior was correct under the
 * old end-of-day expiry (a pre-existing queue on open could hold hours-old
 * windows that had "been sitting there the whole time," which shouldn't
 * re-notify) but is wrong under ALLOCATION_ANSWER_WINDOW_MINUTES: anything
 * in the queue on first load fired within the last 30 minutes by
 * construction, so there's nothing stale to protect against, and staying
 * silent was the worst case — open the app mid-window and get no toast, no
 * desktop notification, and a badge nobody thought to check (2026-08-20,
 * caught by the Opus Lead against production). This assumes the provider
 * mounts once per session (components/shell/app-shell-chrome.tsx, itself
 * rendered from app/(app)/layout.tsx, which Next.js keeps stable across
 * in-segment navigation) — a remounting provider would re-notify on every
 * remount.
 */
export function AllocationQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<AllocationQueueItem[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [total, setTotal] = useState(0);
  const [mostRecentUnanswered, setMostRecentUnanswered] = useState<AllocationQueueItem | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ item: AllocationQueueItem; newCount: number } | null>(null);
  const seenWindowStartsRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(null);
  }, []);

  const refresh = useCallback(async () => {
    const result = await getAllocationQueueForNow(new Date().toISOString());
    setTimezone(result.timezone);
    const items = result.items.map((item) => ({
      windowStart: item.windowStartIso,
      windowEnd: item.windowEndIso,
      initialAllocation: item.prefill,
      prefilled: toPrefilledFlags(item.prefill),
    }));

    // No baseline-seeding special case: the first poll notifies for
    // whatever's already pending, same as every later poll. See this
    // function's own doc comment above for why that's correct now.
    const seen = seenWindowStartsRef.current;
    const newlyFired = items.filter((i) => !seen.has(i.windowStart));
    if (newlyFired.length > 0) {
      newlyFired.forEach((i) => seen.add(i.windowStart));
      notifyDesktop(newlyFired.length);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      setToast({ item: newlyFired[newlyFired.length - 1], newCount: newlyFired.length });
      toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_MS);
    }

    setQueue(items);
    setTotal((prevTotal) => (items.length === 0 ? 0 : Math.max(prevTotal, items.length)));
    setMostRecentUnanswered(
      result.mostRecentUnanswered
        ? {
            windowStart: result.mostRecentUnanswered.windowStartIso,
            windowEnd: result.mostRecentUnanswered.windowEndIso,
            initialAllocation: result.mostRecentUnanswered.prefill,
            prefilled: toPrefilledFlags(result.mostRecentUnanswered.prefill),
          }
        : null
    );
  }, []);

  useEffect(() => {
    // See allocation-checkin-gate.tsx's own useEffect for why the
    // react-hooks/set-state-in-effect suppression here is a known
    // false-positive, not a real synchronous-setState bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(interval);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, [refresh]);

  const completeCurrent = useCallback(() => {
    setQueue((prev) => {
      const next = prev.slice(1);
      if (next.length === 0) {
        setOpen(false);
        // The completed item may have come from mostRecentUnanswered (the
        // manual "check in whenever" fallback, not the polled queue) — clear
        // it optimistically so the dialog can't reopen the same
        // already-answered window before the next poll confirms it.
        setMostRecentUnanswered(null);
      }
      return next;
    });
  }, []);

  return (
    <AllocationQueueContext.Provider
      value={{ queue, timezone, total, open, setOpen, completeCurrent, toast, dismissToast, mostRecentUnanswered }}
    >
      {children}
    </AllocationQueueContext.Provider>
  );
}

export function useAllocationQueue(): AllocationQueueContextValue {
  const ctx = useContext(AllocationQueueContext);
  if (!ctx) throw new Error("useAllocationQueue must be used within AllocationQueueProvider");
  return ctx;
}
