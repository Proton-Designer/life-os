"use client";

import { useTransition } from "react";
import { toggleAdhkar } from "@/app/(app)/deen/actions";
import { cn } from "@/lib/utils";

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
  const periods = [
    { key: "morning" as const, label: "Morning adhkar", completed: morningCompleted },
    { key: "evening" as const, label: "Evening adhkar", completed: eveningCompleted },
  ];

  return (
    <div className="flex gap-3">
      {periods.map((p) => (
        <button
          key={p.key}
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => toggleAdhkar(date, p.key))}
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
