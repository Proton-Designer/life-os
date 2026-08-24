"use client";

import { useOptimistic, useTransition } from "react";
import { logReflectionEntry, decrementReflectionEntry } from "@/app/(app)/deen/actions";
import { type ReflectionEntry } from "@/lib/deen/reflection-strip";
import { ReflectionMonthCalendar } from "./reflection-month-calendar";
import { ReflectionTimeOfDay } from "./reflection-time-of-day";
import { cn } from "@/lib/utils";

const TIERS = [1, 2, 3] as const;
type Tier = (typeof TIERS)[number];

const WEIGHT_LABEL: Record<Tier, string> = { 1: "Light", 2: "Moderate", 3: "Heavy" };
const TINT: Record<Tier, string> = { 1: "", 2: "bg-destructive/5", 3: "bg-destructive/10" };

type OptimisticAction = { type: "log"; tier: Tier } | { type: "decrement"; tier: Tier };

export function ReflectionTracker({
  entries,
  todayStr,
  timezone,
}: {
  entries: ReflectionEntry[];
  todayStr: string;
  timezone: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEntries, applyOptimistic] = useOptimistic(entries, (state, action: OptimisticAction) => {
    if (action.type === "log") {
      return [...state, { date: todayStr, tier: action.tier, createdAt: new Date().toISOString() }];
    }
    const idx = [...state].reverse().findIndex((e) => e.date === todayStr && e.tier === action.tier);
    if (idx === -1) return state;
    const realIdx = state.length - 1 - idx;
    return state.filter((_, i) => i !== realIdx);
  });

  const todayCounts = TIERS.reduce(
    (acc, tier) => {
      acc[tier] = optimisticEntries.filter((e) => e.date === todayStr && e.tier === tier).length;
      return acc;
    },
    {} as Record<Tier, number>
  );

  function handleLog(tier: Tier) {
    startTransition(async () => {
      applyOptimistic({ type: "log", tier });
      await logReflectionEntry(tier);
    });
  }
  function handleDecrement(tier: Tier) {
    startTransition(async () => {
      applyOptimistic({ type: "decrement", tier });
      await decrementReflectionEntry(tier);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((tier) => (
          <div key={tier} className={cn("flex flex-col gap-2 rounded-lg border border-border/40 p-1", TINT[tier])}>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleLog(tier)}
              className="flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-md py-2 disabled:opacity-50"
            >
              <span className="text-xs font-medium">{WEIGHT_LABEL[tier]}</span>
              <span className="font-mono text-lg font-semibold tabular-nums">{todayCounts[tier]}</span>
            </button>
            {todayCounts[tier] > 0 && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDecrement(tier)}
                className="min-h-11 w-full rounded-md border border-border/40 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
              >
                Undo {WEIGHT_LABEL[tier]}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">Resets daily at midnight — history is never deleted.</p>

      <ReflectionMonthCalendar entries={optimisticEntries} todayStr={todayStr} />
      <ReflectionTimeOfDay entries={optimisticEntries} timezone={timezone} />
    </div>
  );
}
