"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getAllocationQueueForNow } from "@/app/(app)/checkin/allocation-actions";
import type { Allocation, DomainKey } from "./allocation";

const POLL_MS = 60 * 1000;

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
 * Single source of truth for the pending allocation check-in queue, shared
 * between the badge (Engineer 2, shell chrome) and the sheet (this file's
 * AllocationCheckinGate) — one poll instead of two independent ones hitting
 * the DB every 60s. Mount once, high in AppShell.
 */
export function AllocationQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<AllocationQueueItem[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const result = await getAllocationQueueForNow(new Date().toISOString());
    setTimezone(result.timezone);
    const items = result.items.map((item) => ({
      windowStart: item.windowStartIso,
      windowEnd: item.windowEndIso,
      initialAllocation: item.prefill,
      prefilled: toPrefilledFlags(item.prefill),
    }));
    setQueue(items);
    setTotal((prevTotal) => (items.length === 0 ? 0 : Math.max(prevTotal, items.length)));
  }, []);

  useEffect(() => {
    // See allocation-checkin-gate.tsx's own useEffect for why the
    // react-hooks/set-state-in-effect suppression here is a known
    // false-positive, not a real synchronous-setState bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const completeCurrent = useCallback(() => {
    setQueue((prev) => {
      const next = prev.slice(1);
      if (next.length === 0) setOpen(false);
      return next;
    });
  }, []);

  return (
    <AllocationQueueContext.Provider value={{ queue, timezone, total, open, setOpen, completeCurrent }}>
      {children}
    </AllocationQueueContext.Provider>
  );
}

export function useAllocationQueue(): AllocationQueueContextValue {
  const ctx = useContext(AllocationQueueContext);
  if (!ctx) throw new Error("useAllocationQueue must be used within AllocationQueueProvider");
  return ctx;
}
