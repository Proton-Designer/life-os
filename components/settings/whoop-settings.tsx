"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectWhoop, type WhoopSettingsStatus } from "@/app/(app)/settings/whoop-actions";

/** Same ISO-slice formatting as canvas-settings.tsx's formatSyncedAt -- avoids an SSR/client hydration mismatch a `Date`/`Intl` locale format would cause. */
function formatConnectedAt(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * P3-18 -- env-gated Whoop connection. Unlike Canvas/RescueTime (BYOK,
 * paste-a-key), Whoop is a real OAuth2 provider: "Connect" is a plain
 * full-page navigation to /api/whoop/authorize (a Route Handler that
 * redirects to Whoop's own consent screen), never a Server Action --
 * OAuth2's authorization-code flow needs a genuine browser redirect.
 *
 * The "not configured" branch is the ONLY state reachable in this
 * deployment right now (no Whoop app registered anywhere) -- see this
 * task's OPEN_QUESTIONS.md entry.
 */
export function WhoopSettings({ initialStatus }: { initialStatus: WhoopSettingsStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    startTransition(async () => {
      const res = await disconnectWhoop();
      setMessage(res.message);
      if (res.ok) setStatus((s) => ({ ...s, connected: false, accessTokenLast4: null, connectedAt: null, scope: null }));
    });
  }

  if (!status.configured) {
    return (
      <p className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
        Whoop isn&apos;t configured on this deployment yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Connect Whoop to bring in your recovery, sleep, and strain data.</p>
      {status.connected ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Connected</span>
            <span className="font-mono text-xs text-muted-foreground">····{status.accessTokenLast4}</span>
          </div>
          {status.connectedAt ? <p className="text-xs text-muted-foreground">Connected {formatConnectedAt(status.connectedAt)}.</p> : null}
          <div>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button asChild size="sm">
            <a href="/api/whoop/authorize">Connect Whoop</a>
          </Button>
        </div>
      )}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
