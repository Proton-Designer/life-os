"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { correctSessionLength } from "@/app/(app)/insights/actions";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";

export type SessionLogRow = {
  id: string;
  kindLabel: string;
  dayLabel: string;
  startLabel: string;
  endLabel: string;
  durationMinutes: number;
  goalMinutes: number | null;
  suspicious: boolean;
};

export function SessionLogPanel({ rows }: { rows: SessionLogRow[] }) {
  const router = useRouter();
  const [fixing, setFixing] = useState<SessionLogRow | null>(null);
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (row: SessionLogRow) => {
    setFixing(row);
    setMinutes(String(row.goalMinutes && row.goalMinutes < row.durationMinutes ? row.goalMinutes : Math.min(60, Math.max(1, row.durationMinutes - 1))));
    setError(null);
  };

  const save = () => {
    if (!fixing) return;
    const value = Number(minutes);
    startTransition(async () => {
      const res = await correctSessionLength(fixing.id, value);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setFixing(null);
      router.refresh();
    });
  };

  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Left a Deep Work or Deep Study session running? Set how long it really was and your hours and Signal:Noise follow.
      </p>
      <ul className="flex flex-col gap-2" data-testid="session-log">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {r.kindLabel} <span className="font-normal text-muted-foreground">· {r.dayLabel}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {r.startLabel} – {r.endLabel}
                {r.suspicious && <span className="ml-2 font-medium text-amber-500">Looks too long</span>}
              </p>
            </div>
            <span className="font-mono tabular-nums">{formatElapsedDuration(r.durationMinutes * 60_000)}</span>
            <Button type="button" variant={r.suspicious ? "default" : "outline"} size="sm" onClick={() => open(r)}>
              Fix length
            </Button>
          </li>
        ))}
      </ul>

      <Dialog open={fixing !== null} onOpenChange={(o) => !o && setFixing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>How long was it really?</DialogTitle>
            <DialogDescription>
              {fixing && `${fixing.kindLabel} on ${fixing.dayLabel}, started ${fixing.startLabel}, recorded as ${formatElapsedDuration(fixing.durationMinutes * 60_000)}.`}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            Actual minutes
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={fixing ? fixing.durationMinutes - 1 : undefined}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              data-testid="session-fix-minutes"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setFixing(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || minutes.trim() === ""}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
