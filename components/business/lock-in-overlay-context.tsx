"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { startWorkSession, endWorkSession } from "@/app/(app)/business/actions";
import { readLockInMinimized, writeLockInMinimized } from "@/lib/business/lock-in-storage";
import type { WorkSessionKind } from "@/lib/business/work-session-kind";

export type ActiveWorkSession = { id: string; startedAtIso: string; kind: WorkSessionKind };

type LockInOverlayContextValue = {
  session: ActiveWorkSession | null;
  /** Whether the full-screen overlay is currently hidden in favor of the
   * minimized (Home Focus module / Business panel) presentation. */
  minimized: boolean;
  isPending: boolean;
  error: string | null;
  startSession: (kind: WorkSessionKind) => void;
  endSession: () => Promise<void>;
  minimize: () => void;
  expand: () => void;
};

const LockInOverlayContext = createContext<LockInOverlayContextValue | null>(null);

export function useLockInOverlay(): LockInOverlayContextValue {
  const ctx = useContext(LockInOverlayContext);
  if (!ctx) throw new Error("useLockInOverlay must be used within a LockInOverlayProvider");
  return ctx;
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

  useEffect(() => {
    if (initialSession) {
      const stored = readLockInMinimized(initialSession.id);
      setMinimized(stored ?? true);
    }
    // Deliberately mount-only: this restores the persisted preference for
    // the session that was already active on page load. A session started
    // client-side afterward calls setMinimized(false) directly in
    // startSession below, not through this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSession = useCallback((kind: WorkSessionKind) => {
    setError(null);
    setIsPending(true);
    void (async () => {
      try {
        const result = await startWorkSession(kind);
        setSession({ id: result.id, startedAtIso: result.startedAt, kind });
        setMinimized(false);
        writeLockInMinimized(result.id, false);
      } catch {
        // The guard can still lose a race (two tabs, a double-click) —
        // surface it as a legible message rather than an unhandled
        // rejection that crashes the page.
        setError("A Lock-In session is already running. Reload to see it.");
      } finally {
        setIsPending(false);
      }
    })();
  }, []);

  const endSession = useCallback(async () => {
    if (!session) return;
    setIsPending(true);
    try {
      await endWorkSession(session.id);
      setSession(null);
    } finally {
      setIsPending(false);
    }
  }, [session]);

  const minimize = useCallback(() => {
    setMinimized(true);
    if (session) writeLockInMinimized(session.id, true);
  }, [session]);

  const expand = useCallback(() => {
    setMinimized(false);
    if (session) writeLockInMinimized(session.id, false);
  }, [session]);

  const value = useMemo(
    () => ({ session, minimized, isPending, error, startSession, endSession, minimize, expand }),
    [session, minimized, isPending, error, startSession, endSession, minimize, expand]
  );

  return <LockInOverlayContext.Provider value={value}>{children}</LockInOverlayContext.Provider>;
}
