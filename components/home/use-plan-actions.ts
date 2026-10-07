"use client";

import { useState } from "react";
import { setPlanItemCompleted, startPlanItem, stopPlanItemTimer } from "@/app/(app)/open/today/plan-item-actions";
import { refreshBusinessViews } from "@/app/(app)/business/actions";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";
import { useHomeRefresh } from "@/components/home/use-home-refresh";
import type { PlanItem } from "@/lib/plan/get-plan-items";

/**
 * The plan rows' writes and the little local state they need on top of the server list: an inline timer's start/stop
 * and an Undo (the person's tick itself goes through the shared row overlay, see components/shared/use-row-overlay.ts).
 * Every write is an imported Server Action (never a function prop across the RSC boundary).
 *
 * Local entries (timer started / stopped, undone) are dropped only when the fresh server list CONFIRMS them, or after
 * LOCAL_MAX_MS; a list that predates a write confirms nothing, so it cannot undo it (Package F's rule).
 */
type Local = { completed: boolean; timerStartedAt: string | null; at: number };
const LOCAL_MAX_MS = 15_000;

function pruneConfirmed(local: Record<string, Local>, items: readonly PlanItem[], now: number): Record<string, Local> {
  let next: Record<string, Local> | null = null;
  for (const [id, entry] of Object.entries(local)) {
    const server = items.find((i) => i.id === id);
    const confirmed = !server || now - entry.at > LOCAL_MAX_MS || (entry.completed ? server.completed : !server.completed && (server.timerStartedAt !== null) === (entry.timerStartedAt !== null));
    if (confirmed) {
      next ??= { ...local };
      delete next[id];
    }
  }
  return next ?? local;
}

export function usePlanActions(items: readonly PlanItem[], hooks: { onUndo?: (id: string) => void } = {}) {
  const scheduleRefresh = useHomeRefresh();
  const lockIn = useLockInOverlay();
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Fresh server data takes over for the rows it now CONFIRMS. Adjusted during render (React's "reset state when a prop
  // changes" pattern), not in an effect, so there is no extra stale paint.
  const [seenItems, setSeenItems] = useState(items);
  if (seenItems !== items) {
    setSeenItems(items);
    setLocal((l) => pruneConfirmed(l, items, Date.now()));
  }

  const view = (i: PlanItem): PlanItem => ({ ...i, completed: local[i.id]?.completed ?? i.completed, timerStartedAt: local[i.id] ? local[i.id]!.timerStartedAt : i.timerStartedAt });

  function say(id: string, message: string | null) {
    setMessages((m) => {
      const next = { ...m };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });
  }

  /** The write behind "Mark Done" / "Done": rejects with the server's message so the shared overlay can restore the row and say why. */
  async function completeWrite(item: PlanItem) {
    say(item.id, null);
    try {
      const res = await setPlanItemCompleted(item.id, true);
      if (!res.ok) {
        say(item.id, res.message);
        throw new Error(res.message);
      }
    } finally {
      scheduleRefresh();
    }
  }

  async function undo(item: PlanItem) {
    say(item.id, null);
    hooks.onUndo?.(item.id);
    setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: item.timerStartedAt, at: Date.now() } }));
    const res = await setPlanItemCompleted(item.id, false);
    if (!res.ok) {
      setLocal((l) => {
        const next = { ...l };
        delete next[item.id];
        return next;
      });
      say(item.id, res.message);
    }
    scheduleRefresh();
  }

  async function start(item: PlanItem) {
    say(item.id, null);
    // The provider already knows about a running session: open it instead of asking the server to refuse.
    if (item.timerStartedAt === null && lockIn.session) {
      say(item.id, "Another session is already running. Opening it.");
      lockIn.expand();
      return;
    }
    setBusy(item.id);
    const res = await startPlanItem(item.id);
    setBusy(null);
    if (!res.ok) {
      if (res.activeSession) lockIn.adoptSession(res.activeSession);
      return say(item.id, res.message);
    }
    if (res.kind === "timer") setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: res.startedAt, at: Date.now() } }));
    // The action returns the running session, so the Lock-In overlay opens at once (nothing else tells the
    // provider); Home and the Business screens catch up in the background.
    else {
      lockIn.adoptSession(res.session);
      void refreshBusinessViews().catch(() => {});
    }
    scheduleRefresh();
  }

  async function stop(item: PlanItem) {
    setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: null, at: Date.now() } }));
    const res = await stopPlanItemTimer(item.id);
    if (!res.ok) say(item.id, res.message);
    scheduleRefresh();
  }

  return { view, messages, busy, completeWrite, undo, start, stop };
}
