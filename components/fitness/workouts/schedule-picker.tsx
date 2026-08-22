"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { expandPreset, type SchedulePreset } from "@/lib/fitness/plan-schedule";
import type { ScheduleDays } from "@/lib/fitness/plan-types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PRESET_OPTIONS: { key: SchedulePreset; label: string }[] = [
  { key: "everyday", label: "Everyday" },
  { key: "weekdays", label: "Weekdays" },
  { key: "weekends", label: "Weekends" },
  { key: "mw", label: "Mon / Wed" },
  { key: "tth", label: "Tue / Thu" },
  { key: "custom", label: "Custom" },
];

/** The reverse of expandPreset — used to select the right preset button when loading an existing draft, rather than always defaulting to "custom". */
function presetForDays(days: ScheduleDays): SchedulePreset {
  const sorted = [...days].sort((a, b) => a - b);
  const matches = (preset: Exclude<SchedulePreset, "custom">) => {
    const presetDays = expandPreset(preset);
    return presetDays.length === sorted.length && presetDays.every((d, i) => d === sorted[i]);
  };
  if (matches("everyday")) return "everyday";
  if (matches("weekdays")) return "weekdays";
  if (matches("weekends")) return "weekends";
  if (matches("mw")) return "mw";
  if (matches("tth")) return "tth";
  return "custom";
}

/**
 * Presets are a UI-only concept (plan §"Schedule presets") — this component
 * only ever emits a plain ScheduleDays array via onChange; the preset label
 * itself is never part of the value and never persisted. expandPreset is
 * imported from lib/fitness/plan-schedule (Engineer A's file) rather than
 * redefined here, so the six options can't drift from the saved-plan
 * expansion.
 */
export function SchedulePicker({
  value,
  onChange,
  label,
}: {
  value: ScheduleDays;
  onChange: (days: ScheduleDays) => void;
  label?: string;
}) {
  const [preset, setPreset] = useState<SchedulePreset>(() => presetForDays(value));

  function selectPreset(next: SchedulePreset) {
    setPreset(next);
    if (next !== "custom") onChange(expandPreset(next));
  }

  function toggleCustomDay(day: number) {
    setPreset("custom");
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  }

  return (
    <div className="flex flex-col gap-2" data-testid="schedule-picker">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Schedule preset">
        {PRESET_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={preset === option.key}
            onClick={() => selectPreset(option.key)}
            className={cn(
              "min-h-11 rounded-md border px-2.5 text-xs",
              preset === option.key
                ? "border-accent-fitness bg-accent-fitness/15 text-accent-fitness"
                : "border-border/40 text-muted-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Custom days">
          {DAY_LABELS.map((dayLabel, dow) => (
            <button
              key={dow}
              type="button"
              aria-pressed={value.includes(dow)}
              onClick={() => toggleCustomDay(dow)}
              className={cn(
                "min-h-11 min-w-11 rounded-md border text-xs",
                value.includes(dow)
                  ? "border-accent-fitness bg-accent-fitness/15 text-accent-fitness"
                  : "border-border/40 text-muted-foreground"
              )}
            >
              {dayLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
