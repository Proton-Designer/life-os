"use client";

import { useRef, useState } from "react";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { useScheduleRefresh } from "@/lib/client/use-optimistic-item";

/**
 * Per-id optimistic booleans for LISTS whose rows can disappear or whose state lives
 * in a parent (dialogs over a fetched list). PERF-2: nothing is disabled while one id
 * saves, writes for the same id run in tap order with the ABSOLUTE value, ids are
 * independent, and a failure reverts only that id (the override is dropped, so the
 * row falls back to the server/parent value) with a shared `error`.
 *
 * - `value(id, serverValue)` is what to render.
 * - `onConfirmed(id, value)` fires once an id's queue has drained with at least one
 *   successful write (value = the last CONFIRMED one): update the parent list there.
 * - `refresh` is one debounced data-free Server Action after writes settle.
 */
export function useOptimisticToggles({
  queuePrefix,
  write,
  onConfirmed,
  refresh,
}: {
  queuePrefix: string;
  write: (id: string, next: boolean) => Promise<unknown>;
  onConfirmed?: (id: string, confirmed: boolean) => void;
  refresh?: () => Promise<unknown>;
}): { value: (id: string, serverValue: boolean) => boolean; set: (id: string, next: boolean) => Promise<void>; error: string | null } {
  const scheduleRefresh = useScheduleRefresh(refresh);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Record<string, number>>({});
  const confirmed = useRef<Record<string, boolean>>({});
  const writeRef = useRef(write);
  writeRef.current = write;
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  function set(id: string, next: boolean): Promise<void> {
    inflight.current[id] = (inflight.current[id] ?? 0) + 1;
    setOverrides((prev) => ({ ...prev, [id]: next }));
    setError(null);
    return enqueueByKey(`${queuePrefix}:${id}`, () => writeRef.current(id, next))
      .then(
        () => {
          confirmed.current[id] = next;
        },
        (e: unknown) => {
          setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
        }
      )
      .finally(() => {
        inflight.current[id] -= 1;
        if (inflight.current[id] === 0) {
          const done = confirmed.current[id];
          delete confirmed.current[id];
          if (done !== undefined) onConfirmedRef.current?.(id, done);
          setOverrides((prev) => {
            const { [id]: _drop, ...rest } = prev;
            return rest;
          });
        }
        scheduleRefresh();
      });
  }

  return { value: (id, serverValue) => (id in overrides ? overrides[id] : serverValue), set, error };
}
