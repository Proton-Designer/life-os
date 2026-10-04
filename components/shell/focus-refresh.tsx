"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createFocusRefresher } from "@/lib/client/focus-refresh";

/**
 * NAV-01a: cross-device freshness now that the Router Cache lives for 30 minutes. When the tab/PWA
 * comes back after >= 60 s away, call router.refresh() once: it re-renders the CURRENT page in
 * place (no skeleton) and drops every other cached page, so the next visit refetches too. Same-device
 * writes already revalidate their own paths; polling Server Actions never do (so they never
 * invalidate this cache). Renders nothing.
 */
export function FocusRefresh() {
  const router = useRouter();
  useEffect(() => {
    const r = createFocusRefresher({ refresh: () => router.refresh() });
    const onVisibility = () => (document.visibilityState === "hidden" ? r.left() : r.returned());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", r.left);
    window.addEventListener("focus", r.returned);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", r.left);
      window.removeEventListener("focus", r.returned);
    };
  }, [router]);
  return null;
}
