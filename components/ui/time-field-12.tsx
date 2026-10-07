"use client";

import { useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WheelTimePicker } from "@/components/ui/wheel-time-picker";
import { cn } from "@/lib/utils";
import { formatHHMM12 } from "@/lib/date-utils";

/**
 * A 12-hour time-of-day control: a pill showing the time ("9:00 PM", or "Set time" when empty) that opens an
 * iOS-alarm-style wheel in a popover. It reads and writes the app's STORAGE format, "HH:MM" 24-hour, so no backend,
 * column or MCP contract changes -- only what the user sees and picks.
 *
 * Why not <input type="time">: its display follows the browser/OS locale, so on a 24-hour locale it shows "21:00" no
 * matter what the page says. The wheel only ever lists hours 1-12 and AM/PM, so 12-hour time is guaranteed everywhere.
 *
 * `value === ""` is the EMPTY state (an optional time). Opening an empty field immediately emits `defaultOpenValue`
 * (default "09:00") so a value is never half-formed and the wheel has somewhere to land. The value updates live as the
 * wheels move; Done / Escape / an outside click closes, Clear (shown only when set) empties it.
 * `minuteStep` (default 5) keeps the minute wheel short; a stored minute that isn't on the step is still offered, so an
 * existing 8:48 PM is shown and kept, not silently rounded.
 */
export function TimeField12({
  value,
  onChange,
  minuteStep = 5,
  disabled,
  id,
  "aria-label": ariaLabel = "Time",
  className,
  defaultOpenValue = "09:00",
}: {
  /** "HH:MM" 24-hour, or "" for none. */
  value: string;
  onChange: (next: string) => void;
  minuteStep?: number;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
  /** "HH:MM" the wheel lands on when it is opened on an empty value. */
  defaultOpenValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleOpenChange(next: boolean) {
    if (next && !value) onChange(defaultOpenValue);
    // In a modal Dialog the popover must live inside the dialog's DOM, or the dialog's scroll lock blocks the wheel.
    if (next) setContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          disabled={disabled}
          aria-label={value ? `${ariaLabel}: ${formatHHMM12(value)}. Change` : `Set ${ariaLabel}`}
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-primary aria-expanded:bg-primary/10",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <Clock className="size-3.5 text-muted-foreground" aria-hidden />
          {value ? formatHHMM12(value) : "Set time"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64" container={container}>
        <WheelTimePicker value={value || defaultOpenValue} onChange={onChange} label={ariaLabel} minuteStep={minuteStep} />
        <div className="flex items-center justify-between">
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
