"use client";

import { useState } from "react";
import { startDayAction } from "@/app/(app)/open/actions";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { Button } from "@/components/ui/button";

/**
 * Start Day (IA-P2). Optimistic: the button flips to "Day started" the instant it is tapped; the
 * write is the idempotent wake mark (one queue key, so a double tap is one write), and Home
 * re-renders into the Today strip when the action's revalidate lands. A failed write puts the
 * button back with an inline error.
 */
export function StartDayButton() {
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    if (started) return;
    setStarted(true);
    setError(null);
    void enqueueByKey("start-day", () => startDayAction()).catch(() => {
      setStarted(false);
      setError("Couldn't start the day. Try again.");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" onClick={start} data-testid="start-day">
        {started ? "Day started" : "Start day"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
