"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { startWorkSession, endWorkSession, setSessionObjectiveCompleted, refreshBusinessViews, getActiveSessionDetail } from "@/app/(app)/business/actions";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { scheduleRouteRefresh } from "@/lib/client/deferred-refresh";
import { readLockInMinimized, writeLockInMinimized } from "@/lib/business/lock-in-storage";
import { goalProgress, goalEndsAtIso } from "@/lib/business/session-goal";
import type { WorkSessionKind } from "@/lib/business/work-session-kind";
import type { SessionObjective } from "@/lib/business/session-objectives";
import type { ObjectiveSelection, SessionStartPayload } from "@/lib/business/session-setup-data";
import type { StartSessionObjectiveInput } from "@/lib/business/actions-core";

// The Lock-In overlay only ever starts/tracks deep-work-class sessions —
// 'learn' (ULM's retrieval session) is deliberately concurrent-safe and
// does not participate in the single-active-session model this provider
// implements (see lib/business/active-session.ts's comment). Narrowing
// here, rather than widening startWorkSession, matches that architecture:
// this was accidentally correct while WorkSessionKind had only two values
// and needs to say so explicitly now that it has three.
export type LockInSessionKind = Extract<WorkSessionKind, "deep_work" | "deep_study">;

export type ActiveWorkSession = {
  id: string;
  startedAtIso: string;
  kind: LockInSessionKind;
  /** Null for a legacy (pre-146) or goal-less (MCP-started) session — the
   * overlay must render this exactly as it always has: bare elapsed
   * counter, no `/ goal`, no progress bar, no auto-end. */
  goalMinutes: number | null;
  objectives: SessionObjective[];
};

type LockInOverlayContextValue = {
  session: ActiveWorkSession | null;
  /** Whether the full-screen overlay is currently hidden in favor of the
   * minimized (Home Focus module / Business panel) presentation. */
  minimized: boolean;
  isPending: boolean;
  error: string | null;
  /** Opens the setup dialog for this kind — does NOT start a session by
   * itself (146: a session no longer starts on tap alone, it starts once
   * the dialog's Start is pressed). Same call shape as before this
   * feature, so FocusModule/LockInPanel's `onLockIn={() => startSession(kind)}`
   * needed no changes at all. */
  startSession: (kind: LockInSessionKind) => void;
  /** The setup dialog's own open state — a controlled prop, not owned by
   * the dialog itself (see its own comment on why: this component never
   * unmounts, so cross-surface closes must be observable here too). */
  setupOpen: boolean;
  pendingKind: LockInSessionKind | null;
  setSetupOpen: (open: boolean) => void;
  /** The setup dialog's onStart — does the actual session creation. */
  confirmSessionStart: (payload: SessionStartPayload) => Promise<void>;
  endSession: () => Promise<void>;
  /** Optimistic, write-through toggle for one objective — see
   * toggleSessionObjectiveCore's header (lib/business/actions-core.ts) for
   * why kill_list_item/task objectives write through to the existing
   * toggle rather than mirroring completion on this table. */
  toggleObjective: (objectiveId: string) => void;
  minimize: () => void;
  expand: () => void;
};

const LockInOverlayContext = createContext<LockInOverlayContextValue | null>(null);

export function useLockInOverlay(): LockInOverlayContextValue {
  const ctx = useContext(LockInOverlayContext);
  if (!ctx) throw new Error("useLockInOverlay must be used within a LockInOverlayProvider");
  return ctx;
}

function toObjectiveInput(selection: ObjectiveSelection): StartSessionObjectiveInput {
  if (selection.kind === "kill_list_item") return { kind: "kill_list_item", killListItemId: selection.id };
  if (selection.kind === "task") return { kind: "task", taskId: selection.id };
  return { kind: "custom", customText: selection.text };
}

function isAllComplete(objectives: SessionObjective[]): boolean {
  return objectives.length > 0 && objectives.every((o) => o.completed);
}

// Single source of truth for "is a Lock-In session running, and is its
// full-screen overlay open" across the whole app (AppShellChrome mounts one
// instance). Starting or ending a session from ANY surface — the overlay,
// the Home Focus module, the Business panel — updates every consumer at
// once; before this provider, FocusModule and LockInPanel each held their
// own optimistic `useState`, which could disagree across surfaces/tabs.
export function LockInOverlayProvider({
  initialSession,
  children,
}: {
  initialSession: ActiveWorkSession | null;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState(initialSession);
  // Default to minimized until the mount effect below can read localStorage
  // — SSR has no window, and a fresh load must never ambush with a
  // full-screen takeover before the stored preference is known.
  const [minimized, setMinimized] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpenState] = useState(false);
  const [pendingKind, setPendingKind] = useState<LockInSessionKind | null>(null);

  useEffect(() => {
    if (initialSession) {
      const stored = readLockInMinimized(initialSession.id);
      setMinimized(stored ?? true);
    }
    // Deliberately mount-only: this restores the persisted preference for
    // the session that was already active on page load. A session started
    // client-side afterward calls setMinimized(false) directly in
    // confirmSessionStart below, not through this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSetupOpen = useCallback((open: boolean) => {
    setSetupOpenState(open);
    if (!open) setPendingKind(null);
  }, []);

  const startSession = useCallback((kind: LockInSessionKind) => {
    setError(null);
    setPendingKind(kind);
    setSetupOpenState(true);
  }, []);

  // A ref, not a plain closure over `session`, specifically so endSessionAt
  // below can have a PERMANENTLY STABLE identity (empty deps) — found in
  // review (Opus Lead, 2026-09-10): with `[session]` as its dep, toggling
  // any single objective gives `endSessionAt` a new identity every time
  // (toggleObjective's optimistic update replaces the whole `session`
  // object), which the goal-check effect below depends on — silently
  // defeating that effect's own "keyed on primitives, not the whole session
  // object" comment. The runtime consequence was harmless (the interval
  // just restarted, and checkGoal() is idempotent and reruns on mount
  // regardless), but the comment claimed a guarantee the code didn't
  // provide — the exact failure shape (a stale comment nobody re-checked)
  // AGENTS.md already names twice. Fixed at the cause, not the symptom: a
  // stable callback is worth having on its own merits, not just to make the
  // comment true.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /** `endedAtIso` omitted = a manual "End Session" tap, where the wall
   * clock IS the honest moment. Given explicitly for the two auto-end
   * paths — see the two effects below. Permanently stable identity (see
   * sessionRef above) — never itself a reason for a dependent effect to
   * re-run. */
  const endSessionAt = useCallback(async (endedAtIso?: string) => {
    const current = sessionRef.current;
    if (!current) return;
    setIsPending(true);
    try {
      await endWorkSession(current.id, endedAtIso);
      setSession(null);
    } finally {
      setIsPending(false);
    }
  }, []);

  const endSession = useCallback(() => endSessionAt(), [endSessionAt]);

  const confirmSessionStart = useCallback(
    async (payload: SessionStartPayload) => {
      if (!pendingKind) throw new Error("No session kind selected");
      const kind = pendingKind;
      setError(null);
      setIsPending(true);
      try {
        await startWorkSession({
          kind,
          goalMinutes: payload.goalMinutes,
          classId: payload.classId,
          objectives: payload.objectives.map(toObjectiveInput),
        });
        // Re-fetch rather than reconstruct client-side: toggling needs the
        // REAL work_session_objectives row ids, which the setup dialog
        // never had (it only ever knew kill_list_item/task/custom ids, not
        // the objective row wrapping each one) — same read path AppShell
        // uses for initialSession, so there's one definition of "session
        // detail", not two that could disagree.
        const detail = await getActiveSessionDetail();
        if (!detail) throw new Error("Session started but could not be loaded");
        setSession({ id: detail.id, startedAtIso: detail.startedAt, kind: detail.kind as LockInSessionKind, goalMinutes: detail.goalMinutes, objectives: detail.objectives });
        setMinimized(false);
        writeLockInMinimized(detail.id, false);
      } catch (e) {
        // Set here too, not just re-thrown: the dialog's own `startError`
        // shows it inline WHILE the dialog stays open (it only closes on
        // success), but `error` is what the idle Focus/Business view has
        // shown since before this feature — keep it meaningful rather than
        // silently stop populating it now that the dialog exists.
        setError(e instanceof Error ? e.message : "Couldn't start the session. Try again.");
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [pendingKind]
  );

  // PERF-4: per-objective ordered ABSOLUTE writes (last tap wins even after a failed
  // write), nothing waits on a re-render, one deferred refresh per burst. `confirmed`
  // holds the last value the server acknowledged; once an objective's queue drains
  // after a failure the checkbox returns to it (only that objective).
  const objectiveInflight = useRef<Record<string, number>>({});
  const objectiveConfirmed = useRef<Record<string, boolean>>({});

  const toggleObjective = useCallback(
    (objectiveId: string) => {
      if (!session) return;
      const current = session.objectives.find((o) => o.id === objectiveId);
      if (!current) return;
      const next = !current.completed;
      const nextObjectives = session.objectives.map((o) => (o.id === objectiveId ? { ...o, completed: next } : o));
      const wasComplete = isAllComplete(session.objectives);
      const nowComplete = isAllComplete(nextObjectives);

      setSession({ ...session, objectives: nextObjectives });

      if (!objectiveInflight.current[objectiveId]) objectiveConfirmed.current[objectiveId] = current.completed;
      objectiveInflight.current[objectiveId] = (objectiveInflight.current[objectiveId] ?? 0) + 1;
      void enqueueByKey(`objective:${objectiveId}`, () => setSessionObjectiveCompleted(objectiveId, next))
        .then(
          () => {
            objectiveConfirmed.current[objectiveId] = next;
          },
          () => {}
        )
        .finally(() => {
          objectiveInflight.current[objectiveId] -= 1;
          if (objectiveInflight.current[objectiveId] === 0) {
            const confirmed = objectiveConfirmed.current[objectiveId];
            delete objectiveConfirmed.current[objectiveId];
            // Functional form: time has passed, so only this objective is touched.
            setSession((prev) => {
              const row = prev?.objectives.find((o) => o.id === objectiveId);
              if (!prev || !row || row.completed === confirmed) return prev; // unchanged: keep identity
              return { ...prev, objectives: prev.objectives.map((o) => (o.id === objectiveId ? { ...o, completed: confirmed } : o)) };
            });
          }
          scheduleRouteRefresh(() => {
            void refreshBusinessViews().catch(() => {});
          });
        });

      // TRANSITION to all-complete, never initial state (that's what makes
      // this a toggle-driven check rather than an effect over `session`
      // that could fire the moment an already-complete session loads) and
      // never for zero objectives (isAllComplete's own `.length > 0` guard).
      // `now()` is the honest ended_at for this auto-end path — unlike the
      // goal-reached path below, there is no "was it actually reached
      // earlier" question to answer.
      if (nowComplete && !wasComplete) {
        void endSessionAt(new Date().toISOString());
      }
    },
    [session, endSessionAt]
  );

  // Goal-reached auto-end. Lives in the PROVIDER, not the overlay
  // component, deliberately: a session keeps running when minimized, and
  // must still auto-end on schedule while minimized — an effect scoped to
  // the (conditionally rendered) overlay would miss that entirely. Keyed on
  // primitives (id/goalMinutes/startedAtIso), not the whole `session`
  // object, so an objective toggle (which changes `session`'s identity but
  // not these three) doesn't restart the interval.
  const sessionId = session?.id ?? null;
  const goalMinutes = session?.goalMinutes ?? null;
  const startedAtIso = session?.startedAtIso ?? null;
  useEffect(() => {
    if (sessionId === null || goalMinutes === null || startedAtIso === null) return;
    const checkGoal = () => {
      if (goalProgress(startedAtIso, goalMinutes, new Date()).reached) {
        // THE AUTO-END TIMESTAMP RULE (lib/business/session-goal.ts):
        // started_at + goal_minutes, never the wall-clock moment this
        // check happened to run — correct even if the tab was closed and
        // reopened long after the goal passed (checkGoal() below runs
        // immediately on mount/reopen, not only after the first interval
        // tick, for exactly that case).
        void endSessionAt(goalEndsAtIso(startedAtIso, goalMinutes));
      }
    };
    checkGoal();
    const interval = setInterval(checkGoal, 5000);
    return () => clearInterval(interval);
  }, [sessionId, goalMinutes, startedAtIso, endSessionAt]);

  const minimize = useCallback(() => {
    setMinimized(true);
    if (session) writeLockInMinimized(session.id, true);
  }, [session]);

  const expand = useCallback(() => {
    setMinimized(false);
    if (session) writeLockInMinimized(session.id, false);
  }, [session]);

  const value = useMemo(
    () => ({
      session,
      minimized,
      isPending,
      error,
      setupOpen,
      pendingKind,
      startSession,
      setSetupOpen,
      confirmSessionStart,
      endSession,
      toggleObjective,
      minimize,
      expand,
    }),
    [session, minimized, isPending, error, setupOpen, pendingKind, startSession, setSetupOpen, confirmSessionStart, endSession, toggleObjective, minimize, expand]
  );

  return <LockInOverlayContext.Provider value={value}>{children}</LockInOverlayContext.Provider>;
}
