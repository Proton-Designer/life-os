"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { scheduleRouteRefresh } from "@/lib/client/deferred-refresh";

/**
 * Returns a function that schedules ONE debounced call of `refresh` -- a data-free
 * Server Action that runs revalidatePath for the surfaces the feature feeds (see
 * lib/client/deferred-refresh.ts). It runs once per burst of taps: it re-renders the
 * current page AND purges the client Router Cache (so Home is not served stale
 * after navigating away) -- `router.refresh()` alone only clears the CURRENT
 * route's cache entry. Nothing waits on it; any failure is ignored (the next
 * refresh / realtime sync catches up).
 */
export function useScheduleRefresh(refresh?: () => Promise<unknown>): () => void {
  return () => {
    if (!refresh) return;
    scheduleRouteRefresh(() => {
      startTransition(() => {
        try {
          void Promise.resolve(refresh()).catch(() => {});
        } catch {
          // Not mounted in an App Router (isolated component tests): nothing to refresh.
        }
      });
    });
  };
}

/**
 * Per-item optimistic state for one tap-rate control (PERF-1; generic since PERF-2 so
 * any feature can reuse it -- pass your own data-free `refresh` Server Action).
 *
 * - `value` flips the instant `set` is called; nothing waits on the server.
 * - Writes for the same `queueKey` run in tap order, so the stored state ends
 *   as the last tap's; different keys never wait on each other and none is lost.
 * - A failed write sets `error`; once the item's queue has drained the value
 *   reverts to the last CONFIRMED state -- only this item, never a sibling.
 * - `pending` is informational only. Callers must NOT disable controls with
 *   it (that was the "everything greyed" bug).
 * - After the queue drains, one debounced `refresh()` re-syncs derived
 *   views (streaks, Home, backlog). Props only overwrite `value` while no
 *   write is in flight.
 */
export function useOptimisticItem<T>({
  serverValue,
  queueKey,
  write,
  onRevert,
  refresh,
}: {
  serverValue: T;
  queueKey: string;
  /** Persist `next`. `previous` is the value shown just before this tap (for relative actions such as +1/-1). */
  write: (next: T, previous: T) => Promise<unknown>;
  /** Called once when the queue drains after a failure, with the last confirmed value -- for callers that mirror this value in parent state. */
  onRevert?: (confirmed: T) => void;
  /** Data-free Server Action (revalidatePath only) run once, debounced, after writes settle. */
  refresh?: () => Promise<unknown>;
}): { value: T; set: (next: T) => Promise<void>; pending: boolean; error: string | null } {
  const scheduleRefresh = useScheduleRefresh(refresh);
  const [value, setValue] = useState<T>(serverValue);
  const [inflight, setInflight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef<T>(serverValue);
  const confirmed = useRef<T>(serverValue);
  const inflightRef = useRef(0);
  const writeRef = useRef(write);
  writeRef.current = write;
  const onRevertRef = useRef(onRevert);
  onRevertRef.current = onRevert;
  const hadError = useRef(false);

  useEffect(() => {
    if (inflightRef.current === 0) {
      shown.current = serverValue;
      confirmed.current = serverValue;
      setValue(serverValue);
    }
  }, [serverValue]);

  /** Resolves (never rejects) once this write has settled and the item has reconciled. */
  function set(next: T): Promise<void> {
    const previous = shown.current;
    shown.current = next;
    setValue(next);
    setError(null);
    inflightRef.current += 1;
    setInflight(inflightRef.current);
    return enqueueByKey(queueKey, () => writeRef.current(next, previous))
      .then(
        () => {
          confirmed.current = next;
        },
        (e: unknown) => {
          hadError.current = true;
          setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
        }
      )
      .finally(() => {
        inflightRef.current -= 1;
        setInflight(inflightRef.current);
        if (inflightRef.current === 0) {
          shown.current = confirmed.current;
          setValue(confirmed.current);
          if (hadError.current) {
            hadError.current = false;
            onRevertRef.current?.(confirmed.current);
          }
        }
        scheduleRefresh();
      });
  }

  return { value, set, pending: inflight > 0, error };
}
