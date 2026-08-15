"use client";

import { useTransition } from "react";
import { logReflectionEntry, decrementReflectionEntry } from "@/app/(app)/deen/actions";
import { buildReflectionSparkline, type ReflectionEntry } from "@/lib/deen/reflection-sparkline";
import { cn } from "@/lib/utils";

const TIERS = [1, 2, 3] as const;
type Tier = (typeof TIERS)[number];

const GLYPH: Record<Tier, string> = { 1: "○", 2: "◐", 3: "●" };
// Deliberately no text label anywhere in this UI beyond the section title —
// tiers are distinguished only by glyph, count, and a subtle red tint that
// increases with severity (present but unlabeled), per the design spec: a
// passerby sees three abstract counters, not a legible moral category.
const TINT: Record<Tier, string> = { 1: "", 2: "bg-destructive/5", 3: "bg-destructive/10" };

export function ReflectionTracker({
  entries,
  todayStr,
}: {
  entries: ReflectionEntry[];
  todayStr: string;
}) {
  const [isPending, startTransition] = useTransition();

  const todayCounts = TIERS.reduce(
    (acc, tier) => {
      acc[tier] = entries.filter((e) => e.date === todayStr && e.tier === tier).length;
      return acc;
    },
    {} as Record<Tier, number>
  );

  const sparkline = buildReflectionSparkline(entries, todayStr);
  const maxCount = Math.max(1, ...sparkline.flatMap((d) => TIERS.map((t) => d.counts[t])));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((tier) => (
          <div
            key={tier}
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-lg border border-border/40 py-3",
              TINT[tier]
            )}
          >
            <button
              type="button"
              aria-label={`Log entry, tier ${tier}`}
              disabled={isPending}
              onClick={() => startTransition(() => logReflectionEntry(tier))}
              className="flex flex-col items-center gap-1 disabled:opacity-50"
            >
              <span className="text-2xl leading-none">{GLYPH[tier]}</span>
              <span className="text-sm font-semibold tabular-nums">{todayCounts[tier]}</span>
            </button>
            <button
              type="button"
              aria-label={`Remove last tier ${tier} entry today`}
              disabled={isPending || todayCounts[tier] === 0}
              onClick={() => startTransition(() => decrementReflectionEntry(tier))}
              className="absolute top-1 right-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              −
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {TIERS.map((tier) => (
          <div key={tier} className="flex items-end gap-1.5">
            <span className="w-3 shrink-0 text-xs text-muted-foreground">{GLYPH[tier]}</span>
            <div className="flex h-6 flex-1 items-end gap-1">
              {sparkline.map((day) => (
                <div
                  key={day.date}
                  className={cn("flex-1 rounded-sm", day.counts[tier] > 0 ? "bg-foreground/30" : "bg-muted")}
                  style={{ height: `${Math.max(15, (day.counts[tier] / maxCount) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
