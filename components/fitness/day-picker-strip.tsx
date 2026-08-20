"use client";

import { cn } from "@/lib/utils";

export type DayCell = {
  dayOfWeek: number; // 1=Mon .. 5=Fri
  label: string;
  workoutId: string | null;
  workoutName: string | null;
};

/**
 * Five cells, Mon–Fri only (spec §3) — navigation, not information display.
 * At 5-of-5 filled a week grid stops conveying anything by contrast, so
 * this is deliberately small and secondary rather than the prominent
 * 7-wide grid the old page had. When nothing is scheduled at all (the
 * starter-plan-only week-one case, spec §5), it reads as "no sessions
 * planned — you're on the daily rep targets" rather than a broken or
 * unconfigured week (Opus Lead, 2026-08-20).
 */
export function DayPickerStrip({
  days,
  selectedDayOfWeek,
  todayDayOfWeek,
  onSelectDay,
}: {
  days: DayCell[];
  selectedDayOfWeek: number;
  todayDayOfWeek: number;
  onSelectDay: (dayOfWeek: number) => void;
}) {
  const nothingPlanned = days.every((d) => d.workoutId === null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5" data-testid="day-picker-strip">
        {days.map((d) => {
          const isSelected = d.dayOfWeek === selectedDayOfWeek;
          const isToday = d.dayOfWeek === todayDayOfWeek;
          return (
            <button
              key={d.dayOfWeek}
              type="button"
              aria-current={isSelected ? "true" : undefined}
              onClick={() => onSelectDay(d.dayOfWeek)}
              className={cn(
                "min-h-11 flex-1 rounded-md border px-1 py-1.5 text-center text-xs",
                isSelected
                  ? "border-accent-fitness bg-accent-fitness/15 text-accent-fitness"
                  : "border-border/40 text-muted-foreground",
                isToday && !isSelected && "border-foreground/30"
              )}
            >
              <span className="block font-medium">{d.label}</span>
              <span className="block truncate text-[10px] opacity-80">
                {d.workoutName ?? "—"}
              </span>
            </button>
          );
        })}
      </div>
      {nothingPlanned && (
        <p className="text-xs text-muted-foreground" data-testid="day-picker-empty-note">
          No sessions planned — you&apos;re on the daily rep targets
        </p>
      )}
    </div>
  );
}
