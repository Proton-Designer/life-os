"use client";

import { useState } from "react";
import { MAX_DURATION_MINUTES, formatDuration } from "@/lib/plan/plan-behavior";

/**
 * "Work on this for ..." -- how long a task's timer runs. A slider in 15-minute steps (up to 8 h) for the usual
 * case and a number box for an exact value (any whole minutes, up to a day). `value` is minutes (or null for no
 * timer); the control never emits 0 or a value past a day. Dragging the slider to 0 clears the timer.
 */

const STEP = 15;
const SLIDER_MAX = 8 * 60;

export function DurationField({ value, onChange, label = "Timer" }: { value: number | null; onChange: (next: number | null) => void; label?: string }) {
  // The box keeps what the person is typing; it re-reads the value whenever the slider (or a parent) changes it.
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (value === null ? "" : String(value));

  function commitTyped(raw: string) {
    setTyped(null);
    const n = Number(raw);
    if (raw.trim() === "") return onChange(null);
    if (Number.isInteger(n) && n >= 1) onChange(Math.min(n, MAX_DURATION_MINUTES));
  }

  return (
    <div className="space-y-2" role="group" aria-label={`${label} length`}>
      <div className="flex items-center gap-3">
        <span className="min-w-[4.5rem] text-sm font-medium tabular-nums" aria-live="polite">
          {value === null ? "No timer" : formatDuration(value)}
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={`${label} minutes`}
            placeholder="min"
            value={shown}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onBlur={(e) => commitTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTyped(e.currentTarget.value);
              }
            }}
            className="h-8 w-16 rounded-lg border border-input bg-transparent px-2 text-center text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
          <span className="text-xs text-muted-foreground">min</span>
        </div>
        {value !== null ? (
          <button type="button" onClick={() => onChange(null)} className="ml-auto text-xs text-muted-foreground underline underline-offset-4">
            Clear
          </button>
        ) : null}
      </div>
      <input
        type="range"
        aria-label={`${label} length slider`}
        min={0}
        max={SLIDER_MAX}
        step={STEP}
        value={Math.min(value ?? 0, SLIDER_MAX)}
        onChange={(e) => {
          setTyped(null);
          const n = Number(e.target.value);
          onChange(n === 0 ? null : n);
        }}
        className="h-6 w-full cursor-pointer accent-primary"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground" aria-hidden>
        <span>0</span>
        <span>2h</span>
        <span>4h</span>
        <span>6h</span>
        <span>8h</span>
      </div>
    </div>
  );
}
