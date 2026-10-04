"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/(app)/settings/actions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/**
 * Deen Mode switch (migration 251). Same optimistic-toggle-with-rollback
 * shape as OptInFeaturesSettings, same server-action-imported-directly idiom
 * (no function props from the Server page). Off only hides -- nothing is
 * deleted -- and the copy says so.
 */
export function DeenModeSettings({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    const previous = on;
    setOn(next); // optimistic

    startTransition(async () => {
      try {
        await updateProfile({ deen_mode: next });
      } catch (e) {
        setOn(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3">
        <Switch id="deen-mode" checked={on} disabled={isPending} onCheckedChange={toggle} className="mt-0.5" />
        <div className="flex flex-col">
          <Label htmlFor="deen-mode" className="text-sm">
            Deen Mode
          </Label>
          <p className="text-xs text-muted-foreground">
            Shows the Faith section — prayer times, Qur&apos;an, sunnah and habits — on Home, in navigation and in
            Settings. Turning it off hides everything; your data is kept.
          </p>
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
