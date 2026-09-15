"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveMySleepIntent, clearMySleepIntent } from "@/app/(app)/close/sleep-intent-actions";
import { isValidBedtime } from "@/lib/night-plan/sleep-intent";

/**
 * "What time are you sleeping tonight" — a standalone capture, deliberately
 * decoupled from the evening close's dump/star/crown ritual (see
 * lib/night-plan/sleep-intent.ts's own header for why). Placed on Home
 * (reachable in both legacy and domains nav modes, same reasoning P2-02's
 * morning brief already used) rather than gated behind the close flow, so
 * it's settable any time in the evening, not only at close.
 */
export function SleepIntentCard({ initialBedtime }: { initialBedtime: string | null }) {
  const [bedtime, setBedtime] = useState(initialBedtime);
  const [input, setInput] = useState(initialBedtime ?? "22:30");
  const [editing, setEditing] = useState(initialBedtime === null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!isValidBedtime(input)) {
      setError("Enter a time as HH:MM, e.g. 22:30.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveMySleepIntent(input);
      if (res.ok) {
        setBedtime(input);
        setEditing(false);
      } else {
        setError(res.message);
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      const res = await clearMySleepIntent();
      if (res.ok) {
        setBedtime(null);
        setEditing(true);
      }
    });
  }

  if (!editing && bedtime) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-border/40 p-4">
        <div>
          <span className="text-sm font-medium">Sleeping at {bedtime} tonight</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={handleClear}>
            Clear
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
      <span className="text-sm font-medium">What time are you sleeping tonight?</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="time"
          value={input}
          disabled={isPending}
          onChange={(e) => setInput(e.target.value)}
          className="rounded-md border border-border/50 bg-transparent px-2 py-1 text-sm"
        />
        <Button size="sm" disabled={isPending} onClick={handleSave}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {bedtime ? (
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
