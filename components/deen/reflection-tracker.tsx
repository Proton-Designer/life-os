"use client";

import { useTransition } from "react";
import { logReflectionEntry, decrementReflectionEntry } from "@/app/(app)/deen/actions";
import { buildReflectionSparkline, type ReflectionEntry } from "@/lib/deen/reflection-sparkline";
import { Sparkline } from "@/components/charts/sparkline";
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
              <span className="font-mono text-sm font-semibold tabular-nums">{todayCounts[tier]}</span>
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

      {/* Opus Lead review (2026-08-16): a zero-history sparkline row rendered
          as a stray 1px flat line in empty space — not informative, just
          visual noise. Suppressed entirely until there's real history to
          show, rather than rendering a trend of nothing. */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {/* Upgraded to the shared Sparkline primitive (Phase C) — one per
              tier, deliberately monochrome (--muted-foreground) rather than
              an escalating color per tier, so no severity implication rides
              along in color the way a red-tint scale would. */}
          {TIERS.map((tier) => (
            <div key={tier} className="flex items-center gap-1.5">
              <span className="w-3 shrink-0 text-xs text-muted-foreground">{GLYPH[tier]}</span>
              <Sparkline values={sparkline.map((day) => day.counts[tier])} colorVar="--muted-foreground" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
