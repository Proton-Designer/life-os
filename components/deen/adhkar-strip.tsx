"use client";

import { toggleAdhkar } from "@/app/(app)/deen/actions";
import { useOptimisticItem } from "@/components/deen/use-optimistic-item";
import { cn } from "@/lib/utils";

type Period = "morning" | "evening";

// PERF-1: one optimistic item per period -- tapping Morning never disables
// Evening, and a failed write reverts only that period.
function AdhkarButton({ date, period, label, completed }: { date: string; period: Period; label: string; completed: boolean }) {
  const item = useOptimisticItem<boolean>({
    serverValue: completed,
    queueKey: `adhkar:${date}:${period}`,
    write: () => toggleAdhkar(date, period),
  });
  return (
    <button
      type="button"
      onClick={() => void item.set(!item.value)}
      aria-pressed={item.value}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium transition-colors",
        item.value ? "bg-accent-deen text-background" : "border border-border/50 text-muted-foreground hover:bg-accent/40"
      )}
    >
      {label}
      {item.error && <span role="alert" className="sr-only"> (not saved)</span>}
    </button>
  );
}

export function AdhkarStrip({
  date,
  morningCompleted,
  eveningCompleted,
}: {
  date: string;
  morningCompleted: boolean;
  eveningCompleted: boolean;
}) {
  return (
    <div className="flex gap-3">
      <AdhkarButton date={date} period="morning" label="Morning adhkar" completed={morningCompleted} />
      <AdhkarButton date={date} period="evening" label="Evening adhkar" completed={eveningCompleted} />
    </div>
  );
}
