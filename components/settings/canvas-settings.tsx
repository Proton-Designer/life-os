"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectCanvas,
  disconnectCanvas,
  refreshCanvasCourses,
  getCanvasCourseMappings,
  setCourseMapping,
  type CanvasConnectionStatus,
  type CanvasCourseMapping,
  type LocalClassOption,
} from "@/app/(app)/settings/canvas-actions";

/**
 * Bring-your-own Canvas settings — same shape and tone as api-key-settings.tsx
 * and connector-settings.tsx: connect/disconnect a credential, plus (Canvas-
 * specific) a per-course mapping list once connected. School works fully
 * without this connected; skipping it costs nothing, same as the AI keys.
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
  const [mappings, setMappings] = useState(initialMappings);
  const [instanceUrl, setInstanceUrl] = useState("");
  const [token, setToken] = useState("");
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
        });
      }
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const res = await disconnectCanvas();
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) setStatus({ connected: false, instanceUrl: null, tokenLast4: null, canvasUserName: null });
    });
  }

  function handleSync() {
    startTransition(async () => {
      const res = await refreshCanvasCourses();
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) setMappings(await getCanvasCourseMappings());
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

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Connect Canvas with a personal access token to pull in your courses and match them to your classes here.
        School works fully without this — nothing else is affected if you skip it.
      </p>

      {!storageConfigured ? (
        <p className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
          Key storage isn&apos;t configured on this deployment yet, so a token can&apos;t be saved securely.
        </p>
      ) : null}

      {status.connected ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{status.instanceUrl}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {status.canvasUserName ? `connected as ${status.canvasUserName} · ` : "connected · "}
              ····{status.tokenLast4}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={handleSync}>
              Sync courses
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>

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
      ) : (
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
      )}

      {message ? (
        <p className={`text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
