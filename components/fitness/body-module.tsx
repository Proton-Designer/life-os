"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * spec §6 — ONE object, two lines, always rendered together. No prop lets a
 * caller show weight without waist or vice versa: there is no `weightOnly`
 * escape hatch, no conditional render around either line. During a
 * successful recomposition the scale can sit flat for months while waist
 * moves — weight alone would tell him he's failing during the exact period
 * he's succeeding, which is the failure mode this structural pairing
 * exists to make impossible, not just discourage.
 *
 * Weight always displays as the 7-day rolling average, never the raw daily
 * reading (day-to-day variation is 1.5-3 lb of water). `null` renders as an
 * honest "—" rather than a fabricated 0 or a hidden line.
 *
 * Each row gets its own "Log" button opening a popup — 2026-08-25/26 batch
 * 2, item 3: Ayman explicitly wants weight/waist loggable ON DEMAND from
 * Cycle Progress checks, but NOT as a daily task ("keep them there, when i
 * want to do it I will"). This was previously the Daily Log's `body_metric`
 * archetype (a task that disappeared once logged, appeared again the next
 * day it was due); this is a plain always-available log affordance with no
 * task semantics — logging today doesn't remove tomorrow's button, there is
 * no "due" state, it simply always sits here.
 */
export function BodyModule({
  weightAvg7d,
  waist,
  onLogWeight,
  onLogWaist,
}: {
  weightAvg7d: number | null;
  waist: { valueIn: number; date: string } | null;
  onLogWeight: (value: number) => Promise<void>;
  onLogWaist: (value: number) => Promise<void>;
}) {
  const [openField, setOpenField] = useState<"weight" | "waist" | null>(null);

  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="body-module">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Weight</span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">
            {weightAvg7d !== null ? `${weightAvg7d} lb` : "—"}
            {weightAvg7d !== null && <span className="ml-1.5 text-xs text-muted-foreground">7-day avg</span>}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpenField("weight")}>
            Log
          </Button>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Waist</span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">
            {waist ? `${waist.valueIn} in` : "—"}
            {waist && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {/* Caught live: toLocaleDateString with no timeZone reads the
                    server's LOCAL system clock, which rolled a UTC-midnight
                    date back a day whenever that local offset is negative
                    (e.g. logging "2026-08-20" displayed as "Aug 19"). This is
                    a plain calendar date, not a moment in time, so it must
                    format against UTC — the same zone it was constructed
                    with — not whatever zone the process happens to run in. */}
                {new Date(`${waist.date}T00:00:00Z`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </span>
            )}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpenField("waist")}>
            Log
          </Button>
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Body fat is mostly a diet outcome — training shapes what&apos;s underneath it.
      </p>

      <Dialog open={openField !== null} onOpenChange={(open) => !open && setOpenField(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{openField === "weight" ? "Log today's weight" : "Log waist"}</DialogTitle>
          </DialogHeader>
          {openField && (
            <BodyMetricQuickEntry
              metric={openField}
              onLog={openField === "weight" ? onLogWeight : onLogWaist}
              onDone={() => setOpenField(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BodyMetricQuickEntry({
  metric,
  onLog,
  onDone,
}: {
  metric: "weight" | "waist";
  onLog: (value: number) => Promise<void>;
  onDone: () => void;
}) {
  const [value, setValue] = useState<number | "">("");
  const [isPending, startTransition] = useTransition();
  function handleLog() {
    if (value === "") return;
    startTransition(async () => {
      await onLog(Number(value));
      onDone();
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="number"
        aria-label={metric === "weight" ? "Weight (lb)" : "Waist (in)"}
        value={value}
        onChange={(e) => setValue(e.target.value === "" ? "" : Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleLog();
          }
        }}
        autoFocus
      />
      <DialogFooter>
        <Button type="button" onClick={handleLog} disabled={isPending}>
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}
