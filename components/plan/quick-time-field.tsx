"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { WheelTimePicker } from "@/components/plan/wheel-time-picker";
import { addMinutesToHHMM, ceilHHMMToStep, formatHHMM12, localClockHHMM } from "@/lib/date-utils";

/**
 * A start-time control that takes one line until it is needed: a pill showing the time (or "Set a time"), and an
 * iOS-alarm-style wheel under it when opened. Planning today opens on the next 5 minutes from the user's own clock
 * (`timezone`, never the browser's); tonight's plan opens on 9:00 AM. Reads and writes "HH:MM" 24-hour (or "" for
 * none); displays 12-hour.
 */
export function QuickTimeField({
  value,
  onChange,
  timezone,
  relativeToNow = false,
  label = "Start time",
}: {
  /** "HH:MM" 24-hour, or "" for none. */
  value: string;
  onChange: (next: string) => void;
  timezone: string;
  /** Planning for today: the wheel opens on the current time instead of 9:00 AM. */
  relativeToNow?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  function openWheel() {
    if (!value) onChange(relativeToNow ? addMinutesToHHMM(ceilHHMMToStep(localClockHHMM(new Date(), timezone), 5), 0) : "09:00");
    setOpen(true);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={value ? `${label}: ${formatHHMM12(value)}. Change` : `Set ${label.toLowerCase()}`}
          onClick={() => (open ? setOpen(false) : openWheel())}
          className="inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors hover:bg-accent/50 aria-expanded:border-primary aria-expanded:bg-primary/10"
        >
          <Clock className="size-3.5 text-muted-foreground" aria-hidden />
          {value ? formatHHMM12(value) : "Set a time"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            Clear
          </button>
        ) : null}
      </div>
      {open ? <WheelTimePicker value={value || "09:00"} onChange={onChange} label={label} /> : null}
    </div>
  );
}
