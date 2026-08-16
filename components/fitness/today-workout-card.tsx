"use client";

import { useTransition } from "react";
import { Dumbbell } from "lucide-react";
import { logWorkout } from "@/app/(app)/fitness/actions";
import { IconChip } from "@/components/ui/icon-chip";
import { Button } from "@/components/ui/button";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { featuredCardStyle } from "@/lib/featured-card-style";

// The one Tier-1 card that needs an inline action (log today's scheduled
// workout in one tap) — same reason NextUpHero is its own component rather
// than a plain KpiCard: a static display card can't carry pending/click
// state. Mirrors KpiCard's exact shell (min-h, shape, featuredCardStyle)
// for visual consistency with its two KPI-row siblings.
export function TodayWorkoutCard({
  scheduledName,
  logged,
  date,
  accent,
}: {
  scheduledName: string | null;
  logged: boolean;
  date: string;
  accent: AccentToken;
}) {
  const [isPending, startTransition] = useTransition();

  function handleLog() {
    if (!scheduledName) return;
    startTransition(() => logWorkout(date, scheduledName, "scheduled"));
  }

  return (
    <div
      className="flex min-h-[168px] flex-col gap-3 rounded-2xl border p-4"
      style={featuredCardStyle(ACCENT_VAR[accent])}
    >
      <IconChip icon={Dumbbell} accent={accent} />
      <div className="flex flex-1 flex-col justify-end gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Today&apos;s workout</p>
        <p className="font-mono text-2xl font-semibold">{scheduledName ?? "Rest day"}</p>
        <p className="text-xs text-muted-foreground">
          {logged ? "Logged" : scheduledName ? "Not logged yet" : "Nothing scheduled today"}
        </p>
      </div>
      {scheduledName && !logged && (
        <Button type="button" size="sm" disabled={isPending} onClick={handleLog}>
          Log it
        </Button>
      )}
    </div>
  );
}
