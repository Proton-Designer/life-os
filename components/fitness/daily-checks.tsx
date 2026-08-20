"use client";

import { useTransition } from "react";
import { cn } from "@/lib/utils";

const PROTEIN_TARGET_LABEL = "~130–150g";
const STEP_TARGET_DEFAULT = 8000;

/**
 * spec §7's revival: two one-tap checkboxes, NOT a 30-day ConsistencyGrid —
 * the old grid was the wrong shape for "did I hit two intentions today,"
 * and reviving that visualisation risks reviving the "what is this for"
 * confusion that killed the panel in the first place.
 *
 * Hard copy constraints, not style preferences: the protein number appears
 * ONCE as a plain caption, never inside a progress bar, never phrased
 * "X of Y g" — this is an intention-check, not a measurement, and nothing
 * here sums or logs grams. The step checkbox must not imply a synced
 * pedometer reading.
 *
 * Step target is a fixed constant for now, not yet wired to a settings
 * affordance (spec asks for user-adjustable) — a known, stated scope
 * trim rather than a silent gap; flagged to the Lead.
 */
export function DailyChecks({
  proteinDone,
  stepsDone,
  onToggle,
}: {
  proteinDone: boolean;
  stepsDone: boolean;
  onToggle: (kind: "protein" | "steps") => Promise<void>;
}) {
  return (
    <ul className="flex flex-col gap-2" data-testid="daily-checks">
      <CheckRow
        kind="protein"
        label="Hit protein target"
        caption={PROTEIN_TARGET_LABEL}
        done={proteinDone}
        onToggle={onToggle}
      />
      <CheckRow
        kind="steps"
        label={`${STEP_TARGET_DEFAULT.toLocaleString()}+ steps`}
        caption={null}
        done={stepsDone}
        onToggle={onToggle}
      />
    </ul>
  );
}

function CheckRow({
  kind,
  label,
  caption,
  done,
  onToggle,
}: {
  kind: "protein" | "steps";
  label: string;
  caption: string | null;
  done: boolean;
  onToggle: (kind: "protein" | "steps") => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        disabled={isPending}
        onClick={() => startTransition(() => onToggle(kind))}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm",
          done ? "border-accent-fitness bg-accent-fitness/10" : "border-border/40"
        )}
      >
        <span className="flex flex-col">
          <span className="font-medium">{label}</span>
          {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
        </span>
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border",
            done ? "border-accent-fitness bg-accent-fitness text-white" : "border-border/60"
          )}
        >
          {done && "✓"}
        </span>
      </button>
    </li>
  );
}
