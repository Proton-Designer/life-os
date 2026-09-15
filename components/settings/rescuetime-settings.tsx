"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectRescueTime,
  disconnectRescueTime,
  syncRescueTimeSummaries,
  type RescueTimeConnectionStatus,
} from "@/app/(app)/settings/rescuetime-actions";

/** Same ISO-slice formatting as canvas-settings.tsx's formatSyncedAt -- no
 * `Date`/`Intl` locale formatting, which would differ between SSR and
 * client hydration and cause a mismatch warning. */
function formatSyncedAt(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * P3-19 -- BYOK RescueTime settings, same shape and tone as
 * canvas-settings.tsx: connect/disconnect a credential, a manual Sync
 * button, last-synced/last-error display. Simpler than Canvas -- no course
 * mapping equivalent, no token-expiry/reconnect flow (a RescueTime API key
 * doesn't expire the way an OAuth-adjacent Canvas PAT can; a rejected key
 * just fails the next sync with a clear message and Disconnect/reconnect is
 * the same one action either way).
 */
export function RescueTimeSettings({
  initialStatus,
  storageConfigured,
}: {
  initialStatus: RescueTimeConnectionStatus;
  storageConfigured: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConnect() {
    const key = apiKey.trim();
    startTransition(async () => {
      const res = await connectRescueTime(key);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setApiKey("");
        setStatus({ connected: true, keyLast4: key.slice(-4), lastSyncedAt: status.lastSyncedAt, lastSyncError: null });
      }
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const res = await disconnectRescueTime();
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) setStatus({ connected: false, keyLast4: null, lastSyncedAt: null, lastSyncError: null });
    });
  }

  function handleSync() {
    startTransition(async () => {
      try {
        const res = await syncRescueTimeSummaries();
        setMessage({ ok: res.ok, text: res.message });
        setStatus((s) => ({
          ...s,
          lastSyncedAt: res.ok ? new Date().toISOString() : s.lastSyncedAt,
          lastSyncError: res.ok ? null : res.message,
        }));
      } catch (err) {
        // Defense in depth (same P2-22 04-verification lesson): a genuinely
        // rejected Server Action call must still surface a message here.
        setMessage({ ok: false, text: err instanceof Error ? err.message : "Sync failed unexpectedly. Try again." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Connect RescueTime with your own API key to pull in a daily productive-vs-distracting breakdown. Insights works
        fully without this — nothing else is affected if you skip it.
      </p>

      {!storageConfigured ? (
        <p className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
          Key storage isn&apos;t configured on this deployment yet, so a key can&apos;t be saved securely.
        </p>
      ) : null}

      {status.connected ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">RescueTime</span>
            <span className="font-mono text-xs text-muted-foreground">connected · ····{status.keyLast4}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {status.lastSyncedAt ? `Last synced ${formatSyncedAt(status.lastSyncedAt)}` : "Never synced yet."}
          </p>
          {status.lastSyncError ? <p className="text-xs text-destructive">{status.lastSyncError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={handleSync}>
              Sync
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
          <Label htmlFor="rescuetime-key" className="text-xs text-muted-foreground">
            RescueTime API key
          </Label>
          <Input
            id="rescuetime-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isPending || !storageConfigured}
          />
          <div>
            <Button size="sm" disabled={isPending || !storageConfigured || !apiKey.trim()} onClick={handleConnect}>
              {isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </div>
      )}

      {message ? <p className={`text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</p> : null}
    </div>
  );
}
