"use client";

import { useEffect, useState, useTransition } from "react";
import { subscribeToPush } from "@/lib/pwa/push-subscribe";
import { Button } from "@/components/ui/button";

/**
 * Batch 3, B3-1 (Opus Lead ruling): the check-in popup is the one moment a
 * missing notification permission is both relevant and obviously
 * actionable — root cause was `notifyDesktop()` (allocation-queue-
 * context.tsx) silently no-op'ing forever when permission was never
 * granted, with no visible trace anywhere in the app. Renders nothing once
 * permission is already granted; reuses `subscribeToPush()` (the same path
 * Settings' NotificationSettings uses) rather than a second ask flow.
 */
export function NotificationPermissionNudge() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // Notification.permission can't be read during SSR — same one-time
  // post-mount read as NotificationSettings/allocation-checkin-gate's own
  // client-only checks.
  useEffect(() => {
    if (typeof Notification === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  function handleEnable() {
    startTransition(async () => {
      const outcome = await subscribeToPush();
      setPermission(typeof Notification !== "undefined" ? Notification.permission : "default");
      setMessage(outcome.ok ? "Notifications enabled." : outcome.reason);
    });
  }

  if (permission === null || permission === "granted" || permission === "unsupported") return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {permission === "denied"
            ? "Notifications are blocked — allow them in your browser settings to get a nudge every 2 hours."
            : "Turn on notifications to get a nudge here every 2 hours."}
        </p>
        {permission !== "denied" && (
          <Button type="button" size="sm" variant="outline" onClick={handleEnable} disabled={isPending} className="shrink-0">
            {isPending ? "Enabling…" : "Enable"}
          </Button>
        )}
      </div>
      {message && (
        <p className="text-xs text-accent-business" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
