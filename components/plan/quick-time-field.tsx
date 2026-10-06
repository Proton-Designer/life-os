"use client";

import { TimeField12 } from "@/components/ui/time-field-12";
import { addMinutesToHHMM, ceilHHMMToStep, formatHHMM12, localClockHHMM } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

/**
 * A start-time picker that needs one tap for the usual cases: "Now" / "In 30 min" / "In 1 hr" (planning today) or a
 * handful of common clock times, with the exact 12-hour field underneath for anything else. Reads and writes the
 * storage format, "HH:MM" 24-hour (or "" for none); the shortcuts are computed on the user's own timezone clock
 * (`timezone`), never the browser's. Display is always 12-hour (TimeField12 / formatHHMM12).
 */

const COMMON_TIMES = ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"] as const;

const CHIP = "min-h-8 rounded-md border px-2.5 text-xs transition-colors aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary";

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
  /** Offer Now / In 30 min / In 1 hr (a plan for today). Tonight's plan has no "now" to be relative to. */
  relativeToNow?: boolean;
  label?: string;
}) {
  function nowStart(offset: number): string {
    return addMinutesToHHMM(ceilHHMMToStep(localClockHHMM(new Date(), timezone), 5), offset);
  }

  return (
    <div className="space-y-1.5">
      <div role="group" aria-label={`${label} shortcuts`} className="flex flex-wrap gap-1.5">
        {relativeToNow
          ? ([["Now", 0], ["In 30 min", 30], ["In 1 hr", 60]] as const).map(([text, offset]) => (
              <button key={text} type="button" className={cn(CHIP)} onClick={() => onChange(nowStart(offset))}>
                {text}
              </button>
            ))
          : null}
        {COMMON_TIMES.map((t) => (
          <button key={t} type="button" aria-pressed={value === t} className={cn(CHIP)} onClick={() => onChange(value === t ? "" : t)}>
            {formatHHMM12(t).replace(":00", "")}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <TimeField12 value={value} onChange={onChange} aria-label={label} />
        {value ? (
          <button type="button" onClick={() => onChange("")} className="text-xs text-muted-foreground underline underline-offset-4">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
