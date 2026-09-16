"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  connectCanvas,
  disconnectCanvas,
  refreshCanvasCourses,
  getCanvasConnectionStatus,
  getCanvasCourseMappings,
  setCourseMapping,
  saveCanvasIcsFeedUrl,
  reconcileCanvasIcs,
  type CanvasConnectionStatus,
  type CanvasCourseMapping,
  type LocalClassOption,
} from "@/app/(app)/settings/canvas-actions";
import { icsFeedDisplaySource } from "@/lib/canvas/ics-feed-display";

const DISCONNECTED_STATUS: CanvasConnectionStatus = {
  connected: false,
  instanceUrl: null,
  tokenLast4: null,
  canvasUserName: null,
  tokenStatus: null,
  lastSyncedAt: null,
  lastSyncError: null,
  icsFeedConnected: false,
  icsFeedLast4: null,
  lastIcsReconcileAt: null,
};

/**
 * Renders an ISO timestamp WITHOUT any timezone conversion (no `Date` local-
 * time formatting) — this Client Component's initial render also happens
 * during SSR, and `toLocaleString()`/`Intl` there would use the server's
 * timezone/locale, then re-run on the client with the browser's, producing a
 * hydration mismatch. Slicing the ISO string is deterministic across both.
 */
function formatSyncedAt(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

type CanvasPath = "token" | "no_token";

/**
 * CANVAS-LITE-01: some schools (UT Arlington) let students mint their own
 * Canvas access tokens; the user's own school (UTD) does not. Every
 * Canvas capability this app has must therefore have a real path that
 * needs no token — this is a display toggle only (never persisted,
 * never gates anything): the ICS feed connect below is independently
 * usable regardless of which tab is showing, same as the token connect
 * form is. Neutral by design (Opus Lead's requirement) — a school's own
 * token policy, not a downgrade notice, and no bullet in the no-token
 * tab is phrased as "what you're missing."
 */
function defaultCanvasPath(status: CanvasConnectionStatus): CanvasPath {
  return status.icsFeedConnected && !status.connected ? "no_token" : "token";
}

/**
 * Bring-your-own Canvas settings — same shape and tone as api-key-settings.tsx
 * and connector-settings.tsx: connect/disconnect a credential, plus (Canvas-
 * specific) a per-course mapping list and sync status once connected. School
 * works fully without this connected; skipping it costs nothing.
 */
export function CanvasSettings({
  initialStatus,
  initialMappings,
  localClasses,
  storageConfigured,
}: {
  initialStatus: CanvasConnectionStatus;
  initialMappings: CanvasCourseMapping[];
  localClasses: LocalClassOption[];
  storageConfigured: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [path, setPath] = useState<CanvasPath>(() => defaultCanvasPath(initialStatus));
  const [mappings, setMappings] = useState(initialMappings);
  const [instanceUrl, setInstanceUrl] = useState("");
  const [token, setToken] = useState("");
  const [icsFeedUrl, setIcsFeedUrl] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConnect() {
    const url = instanceUrl.trim().replace(/\/+$/, "");
    const rawToken = token.trim();
    startTransition(async () => {
      const res = await connectCanvas(url, rawToken);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setToken("");
        setInstanceUrl("");
        setStatus({
          connected: true,
          instanceUrl: url,
          tokenLast4: rawToken.slice(-4),
          canvasUserName: res.message.replace(/^Connected as /, "").replace(/\.$/, ""),
          tokenStatus: "ok",
          lastSyncedAt: status.lastSyncedAt, // reconnect doesn't itself sync — preserve prior history
          lastSyncError: null,
          icsFeedConnected: status.icsFeedConnected,
          icsFeedLast4: status.icsFeedLast4,
          lastIcsReconcileAt: status.lastIcsReconcileAt,
        });
      }
    });
  }

  /** Re-paste a token for an already-known instance URL — the expired-token recovery path. */
  function handleReconnect() {
    const url = status.instanceUrl ?? "";
    const rawToken = token.trim();
    startTransition(async () => {
      const res = await connectCanvas(url, rawToken);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setToken("");
        setStatus((s) => ({ ...s, tokenLast4: rawToken.slice(-4), tokenStatus: "ok", lastSyncError: null }));
      }
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const res = await disconnectCanvas();
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) setStatus(DISCONNECTED_STATUS);
    });
  }

  function handleSync() {
    startTransition(async () => {
      try {
        const res = await refreshCanvasCourses();
        setMessage({ ok: res.ok, text: res.message });
        if (res.ok) {
          setMappings(await getCanvasCourseMappings());
          setStatus((s) => ({ ...s, lastSyncedAt: new Date().toISOString(), lastSyncError: null, tokenStatus: "ok" }));
        } else {
          // Reflect the server's verdict on token health rather than guessing
          // client-side — refreshCanvasCourses only flips tokenStatus when the
          // client reported authExpired, so re-reading status is the honest
          // signal for whether this failure means "reconnect" or "just retry".
          setStatus(await getCanvasConnectionStatus());
        }
      } catch (err) {
        // Defense in depth (P2-22 04-verification finding): refreshCanvasCourses
        // itself now always resolves rather than rejects, but a rejected Server
        // Action (a transport failure, not a Canvas-sync one) must still surface
        // a message here rather than leave the panel silently stuck mid-sync.
        setMessage({ ok: false, text: err instanceof Error ? err.message : "Sync failed unexpectedly. Try again." });
      }
    });
  }

  function handleMappingChange(mappingId: string, rawClassId: string) {
    const classId = rawClassId === "" ? null : rawClassId;
    setMappings((prev) => prev.map((m) => (m.id === mappingId ? { ...m, classId } : m)));
    startTransition(async () => {
      const res = await setCourseMapping(mappingId, classId);
      if (!res.ok) setMessage({ ok: false, text: res.message });
    });
  }

  function handleSaveIcsFeedUrl() {
    const url = icsFeedUrl.trim();
    startTransition(async () => {
      const res = await saveCanvasIcsFeedUrl(url);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setIcsFeedUrl("");
        setStatus((s) => ({ ...s, icsFeedConnected: true, icsFeedLast4: icsFeedDisplaySource(url).slice(-4) }));
      }
    });
  }

  function handleReconcileIcs() {
    startTransition(async () => {
      const res = await reconcileCanvasIcs();
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) setStatus((s) => ({ ...s, lastIcsReconcileAt: new Date().toISOString() }));
    });
  }

  const expired = status.connected && status.tokenStatus === "expired";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        School works fully without connecting Canvas at all — nothing else is affected if you skip this. Some schools let students mint a
        Canvas personal access token; others don&apos;t. Either way, every capability below is available to you.
      </p>

      <SegmentedControl
        options={[
          { label: "My school allows access tokens", value: "token", active: path === "token" },
          { label: "My school doesn't", value: "no_token", active: path === "no_token" },
        ]}
        onSelect={(value) => setPath(value as CanvasPath)}
      />

      {!storageConfigured ? (
        <p className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
          Key storage isn&apos;t configured on this deployment yet, so a token can&apos;t be saved securely.
        </p>
      ) : null}

      {path === "no_token" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4 text-sm">
          <p className="text-muted-foreground">
            You can still get the same capabilities without a token — each of these works today:
          </p>
          <ul className="flex flex-col gap-2 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Calendar feed</span> (below) — brings in assignment titles and due dates
              automatically. It doesn&apos;t carry grades.
            </li>
            <li>
              <span className="font-medium text-foreground">Paste a syllabus or Canvas announcement</span> — open a class on{" "}
              <span className="font-mono">School</span> and use its Syllabus/Announcement tools there.
            </li>
            <li>
              <span className="font-medium text-foreground">Enter grades by hand</span> — open a class&apos;s Assessments tab and type
              them in directly, same as any other edit.
            </li>
            <li>
              <span className="font-medium text-foreground">Connect an AI agent</span> (ChatGPT, Claude, Gemini, Perplexity) — create a
              personal access token in <a href="#connectors" className="underline underline-offset-2 hover:text-foreground">Connectors</a>{" "}
              and have it import your Canvas data on a schedule. The import recipe is landing soon.
            </li>
          </ul>
        </div>
      ) : null}

      {path === "token" && status.connected ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{status.instanceUrl}</span>
            <span className={`font-mono text-xs ${expired ? "text-destructive" : "text-muted-foreground"}`}>
              {expired ? "token expired · " : status.canvasUserName ? `connected as ${status.canvasUserName} · ` : "connected · "}
              ····{status.tokenLast4}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            {status.lastSyncedAt ? `Last synced ${formatSyncedAt(status.lastSyncedAt)}` : "Never synced yet."}
          </p>
          {status.lastSyncError ? <p className="text-xs text-destructive">{status.lastSyncError}</p> : null}

          {expired ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="canvas-reconnect-token" className="text-xs text-muted-foreground">
                Canvas rejected that token. Paste a new one to reconnect.
              </Label>
              <Input
                id="canvas-reconnect-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={isPending || !storageConfigured}
              />
              <div>
                <Button size="sm" disabled={isPending || !storageConfigured || !token.trim()} onClick={handleReconnect}>
                  {isPending ? "Reconnecting…" : "Reconnect"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={isPending} onClick={handleSync}>
                Sync courses
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={handleDisconnect}>
                Disconnect
              </Button>
            </div>
          )}

          {mappings.length > 0 ? (
            <div className="flex flex-col gap-2 pt-2">
              <span className="text-xs font-medium text-muted-foreground">Course mapping</span>
              {mappings.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/30 p-2"
                >
                  <span className="text-sm">
                    {m.canvasCourseName}
                    {m.canvasCourseCode ? ` (${m.canvasCourseCode})` : ""}
                  </span>
                  <select
                    className="rounded-md border border-border/40 bg-background px-2 py-1 text-xs"
                    value={m.classId ?? ""}
                    disabled={isPending}
                    onChange={(e) => handleMappingChange(m.id, e.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {localClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No courses synced yet — click &quot;Sync courses&quot;.</p>
          )}

        </div>
      ) : path === "token" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
          <Label htmlFor="canvas-url" className="text-xs text-muted-foreground">
            Canvas instance URL
          </Label>
          <Input
            id="canvas-url"
            placeholder="https://yourschool.instructure.com"
            autoComplete="off"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            disabled={isPending || !storageConfigured}
          />
          <Label htmlFor="canvas-token" className="text-xs text-muted-foreground">
            Personal access token
          </Label>
          <Input
            id="canvas-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isPending || !storageConfigured}
          />
          <div>
            <Button
              size="sm"
              disabled={isPending || !storageConfigured || !instanceUrl.trim() || !token.trim()}
              onClick={handleConnect}
            >
              {isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* CANVAS-LITE-01: unconditional -- "available to every Canvas student
          regardless of token policy" (this task's own Why). Previously
          nested inside status.connected && !expired, which meant a
          no-token student never saw it at all; the `expired` gate was also
          unrelated (a stale TOKEN says nothing about an independent ICS
          connection) and is dropped here rather than carried forward. */}
      <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
        <span className="text-xs font-medium text-muted-foreground">Calendar feed</span>
        <p className="text-xs text-muted-foreground">
          Paste your Canvas calendar feed URL (Canvas &gt; Calendar &gt; &quot;Calendar Feed&quot;) to bring in assignment titles and due
          dates — works whether or not your school allows access tokens. It doesn&apos;t carry grades.
        </p>
        {status.icsFeedConnected ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">feed connected · ····{status.icsFeedLast4}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {status.lastIcsReconcileAt ? `Last reconciled ${formatSyncedAt(status.lastIcsReconcileAt)}` : "Never reconciled yet."}
            </p>
            <div>
              <Button size="sm" variant="outline" disabled={isPending} onClick={handleReconcileIcs}>
                Reconcile now
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="canvas-ics-url" className="sr-only">
              Canvas calendar feed URL
            </Label>
            <Input
              id="canvas-ics-url"
              type="password"
              placeholder="https://yourschool.instructure.com/feeds/calendars/user_....ics"
              autoComplete="off"
              spellCheck={false}
              value={icsFeedUrl}
              onChange={(e) => setIcsFeedUrl(e.target.value)}
              disabled={isPending || !storageConfigured}
            />
            <div>
              <Button size="sm" variant="outline" disabled={isPending || !storageConfigured || !icsFeedUrl.trim()} onClick={handleSaveIcsFeedUrl}>
                Save feed URL
              </Button>
            </div>
          </div>
        )}
      </div>

      {message ? (
        <p className={`text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
