"use client";

import { useState } from "react";
import { startDayAction, startDayAtAction } from "@/app/(app)/open/actions";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { Button } from "@/components/ui/button";
import { TimeField12 } from "@/components/ui/time-field-12";
import { floorHHMMToStep, formatHHMM12, localClockHHMM } from "@/lib/date-utils";

/**
 * Start Day (IA-P2). Optimistic: the button flips to "Day started" the instant it is tapped; the
 * write is the idempotent wake mark (one queue key, so a double tap is one write), and Home
 * re-renders into the Today strip when the action's revalidate lands. A failed write puts the
 * button back with an inline error.
 *
 * "Woke earlier?" (recovery): you were up at 7 but only open the app at 9. It starts the day with a wake
 * time you pick (12-hour control, never a future time) instead of now. It is offered only HERE, before the
 * mark exists -- the wake mark is immovable once set (migration 153: no update policy, because Delta and
 * Efficiency derive from it), so there is deliberately no "change it later".
 *
 * `timezone` (the user's, from the server) lets the picker open on "now" rounded DOWN to 5 minutes -- down because the
 * server refuses a future wake time. Never the browser's clock.
 */
export function StartDayButton({ timezone = "UTC" }: { timezone?: string }) {
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingTime, setPickingTime] = useState(false);
  const [wakeTime, setWakeTime] = useState("");
  const [saving, setSaving] = useState(false);

  function start() {
    if (started) return;
    setStarted(true);
    setError(null);
    void enqueueByKey("start-day", () => startDayAction()).catch(() => {
      setStarted(false);
      setError("Couldn't start the day. Try again.");
    });
  }

  async function startAt() {
    if (started || saving || !wakeTime) return;
    setSaving(true);
    setError(null);
    try {
      const res = await enqueueByKey("start-day", () => startDayAtAction(wakeTime));
      if (res.ok) {
        setStarted(true);
        setPickingTime(false);
      } else {
        setError(res.message);
      }
    } catch {
      setError("Couldn't start the day. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={start} disabled={saving} data-testid="start-day">
          {started ? "Day started" : "Start day"}
        </Button>
        {!started && !pickingTime ? (
          <button
            type="button"
            onClick={() => setPickingTime(true)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            data-testid="woke-earlier"
          >
            Woke earlier?
          </button>
        ) : null}
      </div>
      {pickingTime && !started ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="woke-earlier-form">
          <span className="text-xs text-muted-foreground">I woke up at</span>
          <TimeField12 value={wakeTime} onChange={setWakeTime} aria-label="Wake time" disabled={saving} defaultOpenValue={floorHHMMToStep(localClockHHMM(new Date(), timezone), 5)} />
          <Button type="button" size="sm" variant="outline" onClick={() => void startAt()} disabled={!wakeTime || saving} data-testid="start-day-at">
            {wakeTime ? `Start day from ${formatHHMM12(wakeTime)}` : "Start day"}
          </Button>
          <button type="button" onClick={() => setPickingTime(false)} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
