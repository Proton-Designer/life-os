"use client";

import { useOptimistic, useTransition } from "react";
import { toggleAdhkar } from "@/app/(app)/deen/actions";
import { cn } from "@/lib/utils";

type Period = "morning" | "evening";

export function AdhkarStrip({
  date,
  morningCompleted,
  eveningCompleted,
}: {
  date: string;
  morningCompleted: boolean;
  eveningCompleted: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticCompleted, toggleOptimistic] = useOptimistic(
    { morning: morningCompleted, evening: eveningCompleted },
    (state, period: Period) => ({ ...state, [period]: !state[period] })
  );
  const periods = [
    { key: "morning" as const, label: "Morning adhkar", completed: optimisticCompleted.morning },
    { key: "evening" as const, label: "Evening adhkar", completed: optimisticCompleted.evening },
  ];

  return (
    <div className="flex gap-3">
      {periods.map((p) => (
        <button
          key={p.key}
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              toggleOptimistic(p.key);
              await toggleAdhkar(date, p.key);
            })
          }
          className={cn(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
            p.completed
              ? "bg-accent-deen text-background"
              : "border border-border/50 text-muted-foreground hover:bg-accent/40"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
