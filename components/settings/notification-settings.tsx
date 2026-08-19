"use client";

import { useEffect, useState, useTransition } from "react";
import { subscribeToPush } from "@/lib/pwa/push-subscribe";
import { Button } from "@/components/ui/button";

type Status = "checking" | "unsupported" | "granted" | "denied" | "default";

/**
 * The only place in the app a subscription can be (re-)triggered outside
 * onboarding — today's one-shot ask there has no recovery path if it fails
 * or if permission was denied and later changed at the OS level. Shows the
 * real failure reason from subscribeToPush() rather than a generic "didn't
 * work" (2026-08-19: register-sw.tsx's old bare `catch {}` is why zero
 * devices had ever registered and nobody could tell why).
 */
export function NotificationSettings() {
  const [status, setStatus] = useState<Status>("checking");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Notification.permission can't be read during SSR (no `window`) and
  // reading it in a lazy useState initializer would hydration-mismatch
  // (server has no window, client does) — this genuinely needs to run once
  // after mount, same exception as allocation-checkin-gate.tsx.
  useEffect(() => {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as Status);
  }, []);

  function handleClick() {
    startTransition(async () => {
      setResult(null);
      const outcome = await subscribeToPush();
      setStatus(typeof Notification !== "undefined" ? (Notification.permission as Status) : "default");
      setResult(outcome.ok ? { ok: true, message: "Notifications enabled on this device." } : { ok: false, message: outcome.reason });
    });
  }

  if (status === "unsupported") {
    return <p className="text-sm text-muted-foreground">Push notifications aren&apos;t supported in this browser.</p>;
  }

  if (status === "checking") return null;

  const label = status === "granted" ? "Re-enable notifications" : "Enable notifications";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {status === "granted"
          ? "Notifications are allowed on this device. If they've stopped arriving, re-enabling refreshes the subscription."
          : status === "denied"
            ? "Notifications are blocked for this device — allow them in your browser or OS settings first, then retry here."
            : "Get prayer reminders and check-in prompts on this device."}
      </p>
      <Button type="button" onClick={handleClick} disabled={isPending} variant="outline" className="self-start">
        {isPending ? "Enabling…" : label}
      </Button>
      {result && (
        <p className={`text-sm ${result.ok ? "text-accent-business" : "text-destructive"}`} role="status">
          {result.message}
        </p>
      )}
    </div>
  );
}
