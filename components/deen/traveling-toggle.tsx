"use client";

import { useOptimistic, useTransition } from "react";
import { setTravelingMode } from "@/app/(app)/deen/actions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function TravelingToggle({ enabled }: { enabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_state, next: boolean) => next
  );

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="traveling-mode"
        checked={optimisticEnabled}
        disabled={isPending}
        onCheckedChange={(checked) =>
          startTransition(async () => {
            setOptimisticEnabled(checked);
            await setTravelingMode(checked);
          })
        }
      />
      <Label htmlFor="traveling-mode" className="text-sm text-muted-foreground">
        Traveling (relaxes on-time/qada reminders)
      </Label>
    </div>
  );
}
