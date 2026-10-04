"use client";

import { setTravelingMode } from "@/app/(app)/deen/actions";
import { useOptimisticItem } from "@/components/deen/use-optimistic-item";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// PERF-1: flips at once; the write is absolute (the intended value), queued in order.
export function TravelingToggle({ enabled }: { enabled: boolean }) {
  const item = useOptimisticItem<boolean>({
    serverValue: enabled,
    queueKey: "deen:traveling",
    write: (next) => setTravelingMode(next),
  });

  return (
    <div className="flex items-center gap-2">
      <Switch id="traveling-mode" checked={item.value} onCheckedChange={(checked) => void item.set(checked)} />
      <Label htmlFor="traveling-mode" className="text-sm text-muted-foreground">
        Traveling (relaxes on-time/qada reminders)
      </Label>
      {item.error && (
        <span role="alert" className="text-xs text-destructive">
          Couldn&apos;t save: {item.error}
        </span>
      )}
    </div>
  );
}
