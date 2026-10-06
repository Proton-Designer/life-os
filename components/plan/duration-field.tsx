"use client";

import { useState } from "react";
import { DURATION_PRESETS, MAX_DURATION_MINUTES, formatDuration } from "@/lib/plan/plan-behavior";
import { cn } from "@/lib/utils";

/**
 * "Work on this for ..." -- how long a task's timer runs. One tap on a preset (15m ... 3h), or Custom for an exact
 * hours + minutes. `value` is minutes (or null for no timer); the control never emits 0 or a value past a day.
 */

const CHIP = "min-h-8 rounded-md border px-2.5 text-xs transition-colors aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary";
const SELECT = "h-8 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const HOURS = Array.from({ length: 13 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export function DurationField({ value, onChange, label = "Timer" }: { value: number | null; onChange: (next: number | null) => void; label?: string }) {
  const isPreset = value !== null && DURATION_PRESETS.includes(value);
  const [custom, setCustom] = useState(value !== null && !isPreset);
  const hours = value === null ? 0 : Math.floor(value / 60);
  const minutes = value === null ? 0 : value % 60;

  function emit(h: number, m: number) {
    const total = h * 60 + m;
    onChange(total >= 1 && total <= MAX_DURATION_MINUTES ? total : null);
  }

  return (
    <div className="space-y-1.5">
      <div role="group" aria-label={`${label} length`} className="flex flex-wrap gap-1.5">
        {DURATION_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value === m}
            className={cn(CHIP)}
            onClick={() => {
              setCustom(false);
              onChange(value === m ? null : m);
            }}
          >
            {formatDuration(m)}
          </button>
        ))}
        <button type="button" aria-pressed={custom} className={cn(CHIP)} onClick={() => setCustom((c) => !c)}>
          Custom
        </button>
        {value !== null ? (
          <button
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(null);
            }}
            className="px-1 text-xs text-muted-foreground underline underline-offset-4"
          >
            Clear
          </button>
        ) : null}
      </div>
      {custom ? (
        <div role="group" aria-label={`${label} custom length`} className="flex items-center gap-1.5 text-sm">
          <select aria-label={`${label} hours`} className={SELECT} value={hours} onChange={(e) => emit(Number(e.target.value), minutes)}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">h</span>
          <select aria-label={`${label} minutes`} className={SELECT} value={minutes} onChange={(e) => emit(hours, Number(e.target.value))}>
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">min</span>
        </div>
      ) : null}
    </div>
  );
}
