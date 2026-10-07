"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The "a row I just completed / removed leaves cleanly and NEVER comes back" bookkeeping (Package F), shared by every list
 * that has rows you tick off: TaskRowList and Home's unified Today list (plan rows and priority rows alike), so all rows
 * leave the same way: strike, a short confirmation beat, a 200 ms fade + collapse, then Completed.
 *
 * It is PLAIN state, deliberately not useOptimistic: that only holds while the surrounding transition is pending and then
 * falls back to the `items` prop, which is still the OLD server list until Home's debounced refresh lands 1-3 s later --
 * so a completed row used to come back (un-struck) until then. An entry is dropped only when the server list confirms it,
 * a failed save, or the safety valve (LOCAL_OVERLAY_MAX_MS).
 */

// Long enough to read as a deliberate confirmation, short enough not to feel laggy.
export const COMPLETE_ANIMATION_MS = 550;
// After that beat the row leaves with a quick fade + height collapse. Keep in step with `duration-200` on RowShell.
export const EXIT_ANIMATION_MS = 200;
// Safety valve for an entry the server never "confirms" (e.g. changed back elsewhere): after this long past the write
// settling, trust the server list again instead of hiding a pending task forever. Home's refresh lands in 1-3 s.
export const LOCAL_OVERLAY_MAX_MS = 15_000;

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** The minimum a row needs for the overlay: an id, whether the server says it is completed, and (log rows) its running count. */
export type OverlayRow = { id: string; completedAtIso?: string | null; log?: { kind: "count"; current: number } | { kind: "choice" } };

type LocalEntry = { token: number } & (
  | { kind: "complete"; completedAtIso: string; phase: "leaving" | "gone" }
  | { kind: "remove" }
  | { kind: "progress"; current: number }
);

const GENERIC_SAVE_ERROR = "Couldn't save — try again";

export function useRowOverlay<T extends OverlayRow>(items: readonly T[]) {
  const [local, setLocal] = useState<Record<string, LocalEntry>>({});
  // A failed save that happened after the row had already left: the row comes back as a fresh row, which shows this.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const seq = useRef(0);
  const valves = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = valves.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  function dropEntry(id: string, token: number) {
    setLocal((prev) => {
      if (prev[id]?.token !== token) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /** (Re)start the safety valve for `id`: drop its entry LOCAL_OVERLAY_MAX_MS from now unless a newer one replaced it. */
  function armValve(id: string, token: number) {
    const prior = valves.current.get(id);
    if (prior) clearTimeout(prior);
    valves.current.set(id, setTimeout(() => dropEntry(id, token), LOCAL_OVERLAY_MAX_MS));
  }

  function putEntry(id: string, entry: LocalEntry) {
    setLocal((prev) => ({ ...prev, [id]: entry }));
  }

  const newToken = () => ++seq.current;

  // The server list takes over once it shows what the entry assumed (the same row, now confirmed). A server list that
  // PREDATES the write (an unrelated refresh) shows the row still pending and changes nothing here, so it cannot
  // resurrect it. A completing row keeps its entry until its exit has played.
  useEffect(() => {
    setLocal((prev) => {
      let next: Record<string, LocalEntry> | null = null;
      for (const [id, entry] of Object.entries(prev)) {
        const current = items.find((i) => i.id === id);
        const confirmed =
          entry.kind === "complete"
            ? entry.phase === "gone" && (!current || !!current.completedAtIso)
            : entry.kind === "remove"
              ? !current
              : !current || !!current.completedAtIso || (current.log?.kind === "count" && current.log.current >= entry.current);
        if (confirmed) {
          next ??= { ...prev };
          delete next[id];
        }
      }
      return next ?? prev;
    });
  }, [items, local]);

  const view = items.flatMap((item): T[] => {
    const entry = local[item.id];
    if (!entry) return [item];
    if (entry.kind === "remove") return [];
    if (entry.kind === "progress") return [item.log?.kind === "count" ? { ...item, log: { ...item.log, current: entry.current } } : item];
    // complete: still a (struck, fading) Pending row while it leaves, then a Completed row.
    if (entry.phase === "leaving") return [{ ...item, completedAtIso: null }];
    return [{ ...item, completedAtIso: item.completedAtIso ?? entry.completedAtIso }];
  });
  const exitingIds = new Set(Object.entries(local).filter(([, e]) => e.kind === "complete" && e.phase === "leaving").map(([id]) => id));

  /** Fade the row out (still struck), then file it under Completed. Resolves with the entry's token once it is gone. */
  async function leaveRow(id: string): Promise<number> {
    const token = newToken();
    putEntry(id, { kind: "complete", completedAtIso: new Date().toISOString(), phase: "leaving", token });
    await sleep(EXIT_ANIMATION_MS);
    setLocal((prev) => {
      const entry = prev[id];
      return entry?.token === token && entry.kind === "complete" ? { ...prev, [id]: { ...entry, phase: "gone" } } : prev;
    });
    armValve(id, token);
    return token;
  }

  /**
   * Run `run` (the real write) at once, but move the row out of Pending only after the confirmation beat. A save that
   * already failed by the time the beat ends keeps the row in Pending (the caller's own row shows the error); one that
   * fails after the row left puts it back in Pending with `errorText(err)`. `run` must reject on failure.
   */
  async function completeRow(id: string, run: () => Promise<void>, errorText: (err: unknown) => string = () => GENERIC_SAVE_ERROR) {
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const settled = run();
    // Track an early failure without leaving an unhandled rejection while the animation runs; the real outcome is awaited below.
    let failedEarly = false;
    settled.catch(() => {
      failedEarly = true;
    });
    await sleep(COMPLETE_ANIMATION_MS);
    if (failedEarly) await settled; // throws: the row never left Pending
    // PERF-1: move the row once the beat has played, NOT when the server (and the Home re-render the action triggers,
    // 1-3 s) has finished. Safe because the move is local state that only the SERVER LIST (or a failure) takes back.
    const token = await leaveRow(id);
    try {
      await settled;
    } catch (err) {
      dropEntry(id, token);
      setRowErrors((prev) => ({ ...prev, [id]: errorText(err) }));
      throw err;
    }
    armValve(id, token); // restart the valve from "the write is confirmed"
  }

  /** The row leaves only once `run` is confirmed (Remove, Delay), and stays gone until the server list agrees. */
  async function removeRow(id: string, run: () => Promise<void>) {
    await run();
    const token = newToken();
    putEntry(id, { kind: "remove", token });
    armValve(id, token);
  }

  /** Drop whatever this hook assumed about `id` (e.g. the person pressed Undo on a row still waiting for its completion to be confirmed). */
  function forget(id: string) {
    const timer = valves.current.get(id);
    if (timer) clearTimeout(timer);
    valves.current.delete(id);
    setLocal((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function progressRow(id: string, current: number) {
    const token = newToken();
    putEntry(id, { kind: "progress", current, token });
    armValve(id, token);
  }

  return { view, exitingIds, rowErrors, completeRow, removeRow, progressRow, leaveRow, forget };
}
