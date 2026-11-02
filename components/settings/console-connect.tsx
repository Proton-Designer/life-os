"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createConsoleToken, type McpTokenStatus } from "@/app/(app)/settings/mcp-token-actions";
import { CONSOLE_TOKEN_LABEL } from "@/lib/mcp/console-token";
import { DEFAULT_TOKEN_EXPIRY, TOKEN_EXPIRY_CHOICES, TOKEN_EXPIRY_LABELS, isTokenExpiryChoice, type TokenExpiryChoice } from "@/lib/mcp/token-expiry";

/**
 * "Connect MyHomeBase console": one button that mints a token limited to the business Kill List (scope kill_list) for the founder's admin console. The raw token lives
 * in this component's state only until he dismisses it; nothing reads it back from the server (same posture as connector-settings.tsx's tokens). Revoking it is the
 * normal "Revoke" in the connected-agents list below. `onCreated` is a plain client callback (no server function is passed as a prop).
 */
export function ConsoleConnect({ onCreated }: { onCreated: (status: McpTokenStatus) => void }) {
  const [expiry, setExpiry] = useState<TokenExpiryChoice>(DEFAULT_TOKEN_EXPIRY);
  const [shown, setShown] = useState<{ token: string; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function connect() {
    setError(null);
    startTransition(async () => {
      const res = await createConsoleToken(expiry);
      if (!res.ok || !res.token || !res.status) {
        setError(res.message);
        return;
      }
      setShown({ token: res.token, expiresAt: res.status.expiresAt });
      setCopied(false);
      onCreated(res.status);
    });
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError("Couldn't copy automatically. Select the token and copy it by hand.");
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border/40 p-4" data-testid="console-connect">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">MyHomeBase console</h3>
        <p className="text-xs text-muted-foreground">
          Links your business Kill List to the MyHomeBase admin console, both ways. The token it makes can read and change <strong>only</strong> your business Kill List
          (add, edit, check off, remove). It cannot see anything else in Life OS. Paste it into the console under Settings → Connections → LifeOS. Revoke it any time below.
        </p>
      </div>

      {shown ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3" data-testid="console-connect-token">
          <p className="text-sm font-medium">{CONSOLE_TOKEN_LABEL} token created, you will not see this again</p>
          <p className="text-xs text-muted-foreground">
            {shown.expiresAt ? `Expires ${new Date(shown.expiresAt).toLocaleDateString()}.` : "Never expires."} Copy it now and paste it into the console. Closing this or reloading loses it;
            you would revoke this one and make another.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted/50 px-2 py-1.5 font-mono text-xs select-all">{shown.token}</code>
            <Button size="sm" variant="outline" onClick={() => copy(shown.token)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setShown(null)}>
            Done, pasted it
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="console-token-expiry" className="text-xs text-muted-foreground">
              Expires
            </Label>
            <select
              id="console-token-expiry"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={expiry}
              disabled={isPending}
              onChange={(e) => isTokenExpiryChoice(e.target.value) && setExpiry(e.target.value)}
            >
              {TOKEN_EXPIRY_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {TOKEN_EXPIRY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" onClick={connect} disabled={isPending}>
            {isPending ? "Creating…" : "Connect MyHomeBase console"}
          </Button>
        </div>
      )}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
