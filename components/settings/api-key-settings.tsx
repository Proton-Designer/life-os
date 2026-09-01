"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveApiKey, removeApiKey, testStoredKey, type KeyStatus } from "@/app/(app)/settings/api-key-actions";

export interface ProviderInfo {
  id: string;
  label: string;
  consoleUrl: string;
  unlocks: string;
}

/**
 * Bring-your-own-key settings.
 *
 * The tone here is load-bearing, not decoration. These features cost the USER
 * money, and the app is fully usable without them — so this section must read
 * as an offer a person can decline without losing anything, never as a
 * limitation to be removed by paying. No "Upgrade", no locked padlocks, no
 * count of what they're missing. Someone who reads this and closes the page has
 * made a perfectly good decision, and the copy should leave them feeling that.
 *
 * The key itself never comes back from the server — only its last four
 * characters — so this component cannot display or leak one even by accident.
 */
export function ApiKeySettings({
  providers,
  initialStatuses,
  storageConfigured,
}: {
  providers: ProviderInfo[];
  initialStatuses: KeyStatus[];
  storageConfigured: boolean;
}) {
  const [statuses, setStatuses] = useState<KeyStatus[]>(initialStatuses);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [isPending, startTransition] = useTransition();

  const statusFor = (id: string) => statuses.find((s) => s.provider === id) ?? null;

  function handleSave(id: string) {
    const key = drafts[id] ?? "";
    startTransition(async () => {
      const res = await saveApiKey(id, key);
      setResult((r) => ({ ...r, [id]: res }));
      if (res.ok) {
        setDrafts((d) => ({ ...d, [id]: "" }));
        setStatuses((s) => [
          ...s.filter((x) => x.provider !== id),
          { provider: id as KeyStatus["provider"], last4: key.trim().slice(-4), label: null, addedAt: new Date().toISOString() },
        ]);
      }
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const res = await removeApiKey(id);
      setResult((r) => ({ ...r, [id]: res }));
      if (res.ok) setStatuses((s) => s.filter((x) => x.provider !== id));
    });
  }

  function handleTest(id: string) {
    startTransition(async () => {
      const res = await testStoredKey(id);
      setResult((r) => ({ ...r, [id]: res }));
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Everything in LifeOS works without this. A few extras are powered by an outside AI service, which charges
        for use — so rather than build that cost into the app, you can connect your own account if you want those
        extras. Nothing here is required, and skipping it costs you nothing.
      </p>

      {!storageConfigured ? (
        <p className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
          Key storage isn&apos;t configured on this deployment yet, so keys can&apos;t be saved securely. Nothing
          else is affected.
        </p>
      ) : null}

      {providers.map((p) => {
        const stored = statusFor(p.id);
        const res = result[p.id];
        return (
          <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{p.label}</span>
              {stored ? (
                <span className="font-mono text-xs text-muted-foreground">connected · ····{stored.last4}</span>
              ) : (
                <span className="text-xs text-muted-foreground">not connected</span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">{p.unlocks}</p>

            {stored ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleTest(p.id)}>
                  Test key
                </Button>
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleRemove(p.id)}>
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`key-${p.id}`} className="text-xs text-muted-foreground">
                  Paste your {p.label} API key
                </Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id={`key-${p.id}`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-…"
                    className="min-w-0 flex-1 font-mono"
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    disabled={isPending || !storageConfigured}
                  />
                  <Button
                    size="sm"
                    disabled={isPending || !storageConfigured || !(drafts[p.id] ?? "").trim()}
                    onClick={() => handleSave(p.id)}
                  >
                    {isPending ? "Checking…" : "Connect"}
                  </Button>
                </div>
                <a
                  href={p.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Where to find your {p.label} key
                </a>
              </div>
            )}

            {res ? (
              <p className={`text-xs ${res.ok ? "text-muted-foreground" : "text-destructive"}`}>{res.message}</p>
            ) : null}
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Your key is encrypted before it&apos;s stored and is never shown again — only the last four characters. Remove
        it any time; the extras switch off and everything else keeps working.
      </p>
    </div>
  );
}
