"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * The ENTRY half of spec §6's pairing — lives on Home, not Fitness
 * (BodyModule is the Fitness-page DISPLAY half; this is deliberately a
 * different component since the two live on different pages). Not in the
 * plan's original Phase 5 file list — same category as
 * assign-workout-picker.tsx, a real gap found while wiring the plan rather
 * than an extra.
 *
 * Weight: passive affordance only — no push, no badge, no notification
 * anywhere in this component. Waist: an active but QUIET nudge — only
 * renders its prompt when `waistDue` is true (~14 days since last entry,
 * computed by the caller), otherwise stays silent rather than asking every
 * time.
 */
export function BodyMetricsEntry({
  waistDue,
  onLogWeight,
  onLogWaist,
}: {
  waistDue: boolean;
  onLogWeight: (weightLb: number) => Promise<void>;
  onLogWaist: (waistIn: number) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="body-metrics-entry">
      <WeightRow onLogWeight={onLogWeight} />
      {waistDue && <WaistRow onLogWaist={onLogWaist} />}
    </div>
  );
}

function WeightRow({ onLogWeight }: { onLogWeight: (weightLb: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 w-fit rounded-md border border-border/40 px-3 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        Log weight
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        aria-label="Weight (lb)"
        className="w-20"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        type="button"
        disabled={isPending || value === ""}
        onClick={() =>
          startTransition(async () => {
            await onLogWeight(Number(value));
            setValue("");
            setOpen(false);
          })
        }
      >
        Save
      </Button>
    </div>
  );
}

function WaistRow({ onLogWaist }: { onLogWaist: (waistIn: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="waist-nudge"
        className="min-h-11 w-fit rounded-md border border-accent-fitness/40 bg-accent-fitness/10 px-3 text-left text-xs text-accent-fitness"
      >
        Log your waist
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        aria-label="Waist (in)"
        className="w-20"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        type="button"
        disabled={isPending || value === ""}
        onClick={() =>
          startTransition(async () => {
            await onLogWaist(Number(value));
            setValue("");
            setOpen(false);
          })
        }
      >
        Save
      </Button>
    </div>
  );
}
