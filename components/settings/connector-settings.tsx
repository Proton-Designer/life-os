"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMcpToken, revokeMcpToken, type McpTokenStatus } from "@/app/(app)/settings/mcp-token-actions";
import { DEFAULT_TOKEN_EXPIRY, TOKEN_EXPIRY_CHOICES, TOKEN_EXPIRY_LABELS, isTokenExpiryChoice, type TokenExpiryChoice } from "@/lib/mcp/token-expiry";

/** "expires Oct 3" / "expired" / "never expires" — an instant compared to now, shown in the viewer's locale like createdAt. */
function expiryText(expiresAt: string | null): string {
  if (!expiresAt) return "never expires";
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t) || t <= Date.now()) return "expired";
  return `expires ${new Date(t).toLocaleDateString()}`;
}

/**
 * Personal-access-token management for the MCP connector (L2,
 * docs/ai-connector/PROGRAM-PLAN.md). Modeled directly on
 * components/settings/api-key-settings.tsx — same create/list/revoke shape,
 * same "no secret survives past the moment it's shown" posture.
 *
 * THE ONE THING THIS COMPONENT MUST NEVER DO: let a raw token outlive the
 * single render right after creation. `justCreated` is cleared by every
 * state-changing action, not just on unmount, and there is no action here
 * that reads a token's value back from the server — creation is the only
 * moment it's handed over at all.
 *
 * No server-calling function is passed as a prop — every action is imported
 * directly into this client component from its own "use server" file, same
 * idiom as api-key-settings.tsx, per AGENTS.md's rule on Server -> Client
 * props.
 */
export function ConnectorSettings({ initialTokens }: { initialTokens: McpTokenStatus[] }) {
  const [tokens, setTokens] = useState<McpTokenStatus[]>(initialTokens);
  const [label, setLabel] = useState("");
  const [wantsRead, setWantsRead] = useState(true);
  const [wantsWrite, setWantsWrite] = useState(false);
  const [expiry, setExpiry] = useState<TokenExpiryChoice>(DEFAULT_TOKEN_EXPIRY);
  const [justCreated, setJustCreated] = useState<{ token: string; status: McpTokenStatus } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    const scopes = [...(wantsRead ? ["read"] : []), ...(wantsWrite ? ["write"] : [])];
    startTransition(async () => {
      const res = await createMcpToken(label, scopes, expiry);
      if (!res.ok || !res.token || !res.status) {
        setError(res.message);
        return;
      }
      setJustCreated({ token: res.token, status: res.status });
      setTokens((t) => [res.status!, ...t]);
      setLabel("");
      setCopied(false);
    });
  }

  function handleRevoke(id: string) {
    startTransition(async () => {
      const res = await revokeMcpToken(id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setTokens((t) => t.map((tok) => (tok.id === id ? { ...tok, revokedAt: new Date().toISOString() } : tok)));
      // A just-revoked token can no longer be shown anyway, but clear it
      // defensively if it happens to be the one on screen.
      setJustCreated((jc) => (jc?.status.id === id ? null : jc));
    });
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Clipboard access can be denied by the browser; the token stays
      // selectable as plain text either way, so this is not a dead end.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        A personal access token lets a tool you trust — a script, Claude Code, a CLI — read or write your Life OS
        data directly. Nothing here is required: the app works without any tokens at all.
      </p>

      {justCreated ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">Token created — you will not see this again</p>
          <p className="text-xs text-muted-foreground">
            Copy it now and store it somewhere safe. Closing this, reloading, or navigating away loses it for good —
            you'd need to revoke this one and create another.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted/50 px-2 py-1.5 font-mono text-xs select-all">
              {justCreated.token}
            </code>
            <Button size="sm" variant="outline" onClick={() => handleCopy(justCreated.token)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setJustCreated(null)}>
            Done — I've saved it
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
        <Label htmlFor="mcp-token-label" className="text-xs text-muted-foreground">
          Label (so you can tell tokens apart later)
        </Label>
        <Input
          id="mcp-token-label"
          placeholder="e.g. Claude Code on laptop"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={isPending}
          className="max-w-sm"
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Permissions</span>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wantsRead} onChange={(e) => setWantsRead(e.target.checked)} disabled={isPending} />
            Read — can look at your data
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wantsWrite} onChange={(e) => setWantsWrite(e.target.checked)} disabled={isPending} />
            Write — can also add or change data
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mcp-token-expiry" className="text-xs text-muted-foreground">
            Expires after
          </Label>
          <select
            id="mcp-token-expiry"
            value={expiry}
            onChange={(e) => {
              if (isTokenExpiryChoice(e.target.value)) setExpiry(e.target.value);
            }}
            disabled={isPending}
            className="h-9 w-full max-w-[12rem] rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {TOKEN_EXPIRY_CHOICES.map((c) => (
              <option key={c} value={c}>
                {TOKEN_EXPIRY_LABELS[c]}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            An expired token simply stops working. You can have up to 20 active tokens.
          </span>
        </div>

        <Button
          size="sm"
          className="self-start"
          disabled={isPending || (!wantsRead && !wantsWrite)}
          onClick={handleCreate}
        >
          {isPending ? "Creating…" : "Create token"}
        </Button>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      {tokens.length > 0 ? (
        <div className="flex flex-col gap-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/40 p-3"
            >
              {/* min-w-0: WITHOUT it, a flex child never shrinks below its
                  content's intrinsic width, so a long unbroken label value
                  (found live: an old OAuth-issued token auto-labeled with a
                  40-char client_id) forces this whole row, and the page,
                  wider than the viewport — 320px overflow, not a display
                  preference. break-all on both spans is the second half:
                  min-w-0 lets the box shrink, break-all is what lets the
                  TEXT actually wrap inside it once it does. Applies to any
                  long label, not just this one value — a user-typed label
                  has the same failure mode. */}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium break-all">{t.label ?? "Untitled token"}</span>
                <span className="font-mono text-xs text-muted-foreground break-all">
                  ····{t.last4} · {t.scopes.join(" + ")} · created {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : " · never used"}
                  {t.revokedAt ? null : ` · ${expiryText(t.expiresAt)}`}
                </span>
              </div>
              {t.revokedAt ? (
                <span className="text-xs text-muted-foreground">revoked</span>
              ) : (
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleRevoke(t.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No tokens yet.</p>
      )}
    </div>
  );
}
