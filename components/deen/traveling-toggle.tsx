"use client";

import { useTransition } from "react";
import { setTravelingMode } from "@/app/(app)/deen/actions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function TravelingToggle({ enabled }: { enabled: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="traveling-mode"
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(checked) => startTransition(() => setTravelingMode(checked))}
      />
      <Label htmlFor="traveling-mode" className="text-sm text-muted-foreground">
        Traveling (relaxes on-time/qada reminders)
      </Label>
    </div>
  );
}
