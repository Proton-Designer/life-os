"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_DEBOUNCE_MS = 10_000;

// Same-tab revisits already get fresh data via revalidatePath() busting the
// client router cache, but that signal only reaches the session that
// performed the mutation — a different tab/device sharing the same account
// keeps its own cached view until staleTimes.dynamic naturally expires (up
// to 1hr, see next.config.ts). Refreshing on an actual hidden->visible
// transition closes that gap without reintroducing a skeleton flash:
// router.refresh() merges the RSC payload in place rather than navigating,
// so it doesn't fall back to loading.tsx the way a stale-cache revisit does.
export function FocusRefresh() {
  const router = useRouter();
  const wasHiddenRef = useRef(false);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
        return;
      }
      // Only refresh on a genuine hidden->visible transition, never on
      // mount while already visible.
      if (!wasHiddenRef.current) return;
      wasHiddenRef.current = false;

      const now = Date.now();
      if (now - lastRefreshRef.current < REFRESH_DEBOUNCE_MS) return;
      lastRefreshRef.current = now;
      router.refresh();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [router]);

  return null;
}
