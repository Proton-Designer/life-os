"use client";

import { useOptimisticItem } from "@/components/deen/use-optimistic-item";
import { logReflectionEntry, decrementReflectionEntry } from "@/app/(app)/deen/actions";
import { type ReflectionEntry } from "@/lib/deen/reflection-strip";
import { ReflectionMonthCalendar } from "./reflection-month-calendar";
import { ReflectionTimeOfDay } from "./reflection-time-of-day";
import { cn } from "@/lib/utils";

const TIERS = [1, 2, 3] as const;
type Tier = (typeof TIERS)[number];

const WEIGHT_LABEL: Record<Tier, string> = { 1: "Light", 2: "Moderate", 3: "Heavy" };
const TINT: Record<Tier, string> = { 1: "", 2: "bg-destructive/5", 3: "bg-destructive/10" };

// PERF-1: one optimistic item per tier. Counts are relative on the server
// (+1 / -1), the per-tier queue keeps them in tap order, and neither the other
// tiers nor the Undo button are ever disabled while one saves.
function TierControl({ tier, count }: { tier: Tier; count: number }) {
  const item = useOptimisticItem<number>({
    serverValue: count,
    queueKey: `reflection:${tier}`,
    write: (next, previous) => (next > previous ? logReflectionEntry(tier) : decrementReflectionEntry(tier)),
  });
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border border-border/40 p-1", TINT[tier])}>
      <button
        type="button"
        onClick={() => void item.set(item.value + 1)}
        className="flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-md py-2"
      >
        <span className="text-xs font-medium">{WEIGHT_LABEL[tier]}</span>
        <span className="font-mono text-lg font-semibold tabular-nums">{item.value}</span>
      </button>
      {item.value > 0 && (
        <button
          type="button"
          onClick={() => void item.set(item.value - 1)}
          className="min-h-11 w-full rounded-md border border-border/40 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          Undo {WEIGHT_LABEL[tier]}
        </button>
      )}
      {item.error && (
        <p role="alert" className="px-1 text-[11px] text-destructive">
          Not saved: {item.error}
        </p>
      )}
    </div>
  );
}

export function ReflectionTracker({
  entries,
  todayStr,
  timezone,
}: {
  entries: ReflectionEntry[];
  todayStr: string;
  timezone: string;
}) {
  const todayCounts = TIERS.reduce(
    (acc, tier) => {
      acc[tier] = entries.filter((e) => e.date === todayStr && e.tier === tier).length;
      return acc;
    },
    {} as Record<Tier, number>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((tier) => (
          <TierControl key={tier} tier={tier} count={todayCounts[tier]} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">Resets daily at midnight — history is never deleted.</p>

      <ReflectionMonthCalendar entries={entries} todayStr={todayStr} />
      <ReflectionTimeOfDay entries={entries} timezone={timezone} />
    </div>
  );
}
