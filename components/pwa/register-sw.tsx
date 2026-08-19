"use client";

import { useEffect } from "react";
import { subscribeToPush } from "@/lib/pwa/push-subscribe";

export function RegisterSw() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[push] service worker registration failed:", err);
    });

    // Returning-session re-check only — onboarding handles the first ask
    // (via the same subscribeToPush, see onboarding-wizard.tsx) and
    // Settings offers a manual retry. This effect never prompts; it only
    // refreshes an already-granted subscription (e.g. after the browser
    // rotated it), so a real failure here is worth knowing about even
    // though nothing in the UI is watching for it right now.
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    subscribeToPush().then((result) => {
      if (!result.ok) {
        console.error("[push] background re-subscribe failed:", result.reason);
      }
    });
  }, []);

  return null;
}
