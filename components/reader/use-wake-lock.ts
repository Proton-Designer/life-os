"use client";

import { useEffect } from "react";

type WakeLockSentinelLike = { release(): Promise<void> };

/** Keeps the screen on while `active` (an RSVP read stalls if the tablet dims mid-chapter). Silently a no-op where unsupported. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = () => {
      wl.request("screen")
        .then((s) => {
          if (cancelled) void s.release().catch(() => {});
          else sentinel = s;
        })
        .catch(() => {});
    };
    acquire();
    // The browser drops the lock when the tab is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
