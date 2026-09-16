"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWebhook, deleteWebhook, testFireWebhook, type WebhookStatus } from "@/app/(app)/settings/webhook-actions";

/**
 * P4-22 -- outbound webhooks, vertical slice: add / test-fire / remove one,
 * for the single "write.ok" event type. Same shape and "secret shown once"
 * posture as connector-settings.tsx's own PAT create flow.
 */
export function WebhookSettings({ initialWebhooks }: { initialWebhooks: WebhookStatus[] }) {
  const [webhooks, setWebhooks] = useState<WebhookStatus[]>(initialWebhooks);
  const [url, setUrl] = useState("");
  const [justCreated, setJustCreated] = useState<{ secret: string; status: WebhookStatus } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await createWebhook(url);
      if (!res.ok || !res.secret || !res.status) {
        setError(res.message);
        return;
      }
      setJustCreated({ secret: res.secret, status: res.status });
      setWebhooks((w) => [res.status!, ...w]);
      setUrl("");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteWebhook(id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setWebhooks((w) => w.filter((wh) => wh.id !== id));
      setJustCreated((jc) => (jc?.status.id === id ? null : jc));
    });
  }

  function handleTestFire(id: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await testFireWebhook(id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message);
    });
  }

  async function handleCopy(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Get a signed HTTP POST whenever one of your writes succeeds — useful for your own automation
        outside LifeOS. Nothing here is required: the app works without any webhooks at all.
      </p>

      {justCreated ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">Webhook created — this signing secret will not be shown again</p>
          <p className="text-xs text-muted-foreground">
            Every delivery is signed with it (header <span className="font-mono">X-LifeOS-Webhook-Signature</span>).
            Copy it now — you'd need to remove this webhook and add a new one to get another.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted/50 px-2 py-1.5 font-mono text-xs select-all">
              {justCreated.secret}
            </code>
            <Button size="sm" variant="outline" onClick={() => handleCopy(justCreated.secret)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setJustCreated(null)}>
            Done — I've saved it
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
        <Label htmlFor="webhook-url" className="text-xs text-muted-foreground">
          URL to receive deliveries (https only)
        </Label>
        <Input
          id="webhook-url"
          placeholder="https://your-server.example.com/lifeos-webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isPending}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground">Fires on: a write succeeding.</span>
        <Button size="sm" className="self-start" disabled={isPending || !url.trim()} onClick={handleCreate}>
          {isPending ? "Creating…" : "Add webhook"}
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      </div>

      {webhooks.length > 0 ? (
        <div className="flex flex-col gap-2">
          {webhooks.map((w) => (
            <div key={w.id} className="flex flex-col gap-2 rounded-xl border border-border/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium break-all">{w.url}</span>
                  <span className="font-mono text-xs text-muted-foreground break-all">
                    ····{w.secretLast4} · {w.event}
                    {w.active ? "" : " · disabled after repeated failures"}
                    {w.lastDeliveryAt ? ` · last delivery ${w.lastDeliveryStatus} ${new Date(w.lastDeliveryAt).toLocaleString()}` : " · never delivered yet"}
                  </span>
                  {w.lastDeliveryStatus === "failed" && w.lastDeliveryError ? (
                    <span className="text-xs text-destructive break-all">{w.lastDeliveryError}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleTestFire(w.id)}>
                    Test fire
                  </Button>
                  <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleDelete(w.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No webhooks yet.</p>
      )}
    </div>
  );
}
