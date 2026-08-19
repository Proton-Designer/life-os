/**
 * Shared push-subscribe flow — used by both the background re-check
 * (components/pwa/register-sw.tsx) and the interactive Settings button
 * (components/settings/notification-settings.tsx), so there's exactly one
 * place that can fail silently instead of two.
 *
 * Never throws: every failure mode returns `{ ok: false, reason }` with a
 * real, specific message instead of being swallowed. Production evidence
 * (2026-08-19): zero devices have ever registered, and the previous
 * register-sw.tsx ended in a bare `catch {}` — there was no way to tell
 * whether that was permission denial, a missing VAPID key, a server 500, or
 * something else, for anyone including the person debugging it.
 */

export type PushSubscribeResult = { ok: true } | { ok: false; reason: string };

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes;
}

/**
 * Requests permission if not already granted, registers the service
 * worker, subscribes to push, and POSTs the subscription to the server.
 * Safe to call from a background effect (won't prompt twice — the browser
 * itself no-ops `requestPermission()` once a decision has been made) or
 * from a direct user click (Settings' "Enable notifications" button).
 */
export async function subscribeToPush(): Promise<PushSubscribeResult> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "Service workers aren't supported in this browser." };
  }
  if (!("PushManager" in window) || typeof Notification === "undefined") {
    return { ok: false, reason: "Push notifications aren't supported in this browser." };
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    return { ok: false, reason: "Push isn't configured on this deployment (missing VAPID key)." };
  }

  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        reason:
          permission === "denied"
            ? "Notifications are blocked — re-enable them in your browser or device settings, then try again."
            : "Permission wasn't granted.",
      };
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { error?: string });
      return { ok: false, reason: `Server rejected the subscription (${response.status}): ${body.error ?? "unknown error"}` };
    }

    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[push] subscribeToPush failed:", err);
    return { ok: false, reason: reason || "Unknown error while subscribing to push." };
  }
}
