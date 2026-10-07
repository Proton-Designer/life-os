"use client";

import { useState } from "react";
import { pausePlanItem, setPlanItemCompleted, startPlanItem } from "@/app/(app)/open/today/plan-item-actions";
import { refreshBusinessViews } from "@/app/(app)/business/actions";
import { useLockInOverlay } from "@/components/business/lock-in-overlay-context";
import { useHomeRefresh } from "@/components/home/use-home-refresh";
import type { PlanItem } from "@/lib/plan/get-plan-items";
import { planTimerState } from "@/lib/plan/plan-behavior";

/**
 * The plan rows' writes and the little local state they need on top of the server list: an inline timer's start / pause /
 * resume and an Undo (the person's Mark Done itself goes through the shared row overlay, see
 * components/shared/use-row-overlay.ts). Every write is an imported Server Action (never a function prop across the RSC
 * boundary).
 *
 * Local entries (timer started, paused, undone) are dropped only when the fresh server list CONFIRMS them, or after
 * LOCAL_MAX_MS; a list that predates a write confirms nothing, so it cannot undo it (Package F's rule).
 */
type Local = { completed: boolean; timerStartedAt: string | null; elapsedSeconds: number; at: number };
const LOCAL_MAX_MS = 15_000;

function pruneConfirmed(local: Record<string, Local>, items: readonly PlanItem[], now: number): Record<string, Local> {
  let next: Record<string, Local> | null = null;
  for (const [id, entry] of Object.entries(local)) {
    const server = items.find((i) => i.id === id);
    const sameRunning = !!server && (server.timerStartedAt !== null) === (entry.timerStartedAt !== null);
    // An entry that is paused or idle (nothing running) is confirmed once the server agrees there is time banked (or not).
    const sameBank = !!server && (entry.timerStartedAt !== null || entry.elapsedSeconds > 0 === server.timerElapsedSeconds > 0);
    const confirmed = !server || now - entry.at > LOCAL_MAX_MS || (entry.completed ? server.completed : !server.completed && sameRunning && sameBank);
    if (confirmed) {
      next ??= { ...local };
      delete next[id];
    }
  }
  return next ?? local;
}

export function usePlanActions(items: readonly PlanItem[]) {
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

  const activeSessionTaskId = lockIn.session?.planTaskId ?? null;

  const view = (i: PlanItem): PlanItem => {
    const l = local[i.id];
    // A session paused from the Deep Session overlay: show "Paused" at once, before Home's refresh lands the banked time.
    const hint = lockIn.pausedHints[i.id];
    const hinted = !l && hint !== undefined && !i.completed && i.timerStartedAt === null && i.timerElapsedSeconds === 0 && activeSessionTaskId !== i.id;
    return {
      ...i,
      completed: l?.completed ?? i.completed,
      timerStartedAt: l ? l.timerStartedAt : i.timerStartedAt,
      timerElapsedSeconds: l ? l.elapsedSeconds : hinted ? hint : i.timerElapsedSeconds,
    };
  };

  function say(id: string, message: string | null) {
    setMessages((m) => {
      const next = { ...m };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });
  }

  /** The write behind every "Mark Done": rejects with a message so the shared overlay can restore the row and say why. */
  async function completeWrite(item: PlanItem) {
    say(item.id, null);
    try {
      if (activeSessionTaskId === item.id) {
        // A session is working on this line: the provider ends it through the End Session path, banks it and completes the line.
        await lockIn.completePlanSession({ announce: false });
        return;
      }
      const res = await setPlanItemCompleted(item.id, true);
      if (!res.ok) throw new Error(res.message);
    } catch (err) {
      say(item.id, err instanceof Error && err.message ? err.message : "Couldn't update that task. Try again.");
      throw err;
    } finally {
      scheduleRefresh();
    }
  }

  async function undo(item: PlanItem) {
    say(item.id, null);
    setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: null, elapsedSeconds: item.timerElapsedSeconds, at: Date.now() } }));
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

  /** Start, and Resume from a pause (the same call: an inline timer keeps what is banked, a session continues with the goal that is left). */
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
    if (res.kind === "timer") setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: res.startedAt, elapsedSeconds: item.timerElapsedSeconds, at: Date.now() } }));
    // The action returns the running session, so the Lock-In overlay opens at once (nothing else tells the
    // provider); Home and the Business screens catch up in the background.
    else {
      lockIn.adoptSession(res.session);
      void refreshBusinessViews().catch(() => {});
    }
    scheduleRefresh();
  }

  /** Pause: banks the running stretch (an inline timer) or ends + banks the running Deep Session. It REPLACES the old Stop, which reset the timer. */
  async function pause(item: PlanItem) {
    say(item.id, null);
    if (planTimerState(item, activeSessionTaskId) === "running-session") {
      try {
        await lockIn.pauseSession(); // server action + overlay closes; the hint above shows "Paused" until Home's refresh
      } catch {
        say(item.id, "Couldn't pause that. Try again.");
      }
      scheduleRefresh();
      return;
    }
    // Inline: freeze the readout at once from the client clock (display only), then take the server's banked value.
    const started = item.timerStartedAt ? new Date(item.timerStartedAt).getTime() : Date.now();
    const optimistic = item.timerElapsedSeconds + Math.max(0, Math.floor((Date.now() - started) / 1000));
    setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: null, elapsedSeconds: optimistic, at: Date.now() } }));
    const res = await pausePlanItem(item.id);
    if (!res.ok) {
      setLocal((l) => {
        const next = { ...l };
        delete next[item.id];
        return next;
      });
      say(item.id, res.message);
    } else {
      setLocal((l) => ({ ...l, [item.id]: { completed: false, timerStartedAt: null, elapsedSeconds: res.elapsedSeconds, at: Date.now() } }));
    }
    scheduleRefresh();
  }

  return { view, messages, busy, activeSessionTaskId, completeWrite, undo, start, pause };
}
