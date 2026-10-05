"use client";

import { cn } from "@/lib/utils";
import { split12Hour, to24HourString, type Meridiem } from "@/lib/date-utils";

/**
 * A 12-hour time-of-day control: hour (1-12) / minute / AM-PM selects. It reads and writes the app's STORAGE format,
 * "HH:MM" 24-hour, so no backend, column or MCP contract changes -- only what the user sees and picks.
 *
 * Why not <input type="time">: its display follows the browser/OS locale, so on a 24-hour locale it shows "21:00" no
 * matter what the page says. Fixed AM/PM selects are the only way to guarantee regular 12-hour time everywhere.
 *
 * `value === ""` is the EMPTY state (an optional time): the selects show "—"; the first choice fills the rest with a
 * sensible default (":00", AM) so a value is never half-formed. The control never emits a malformed string.
 * `minuteStep` (default 5) keeps the minute list short; a stored minute that isn't on the step is still offered, so an
 * existing 8:48 PM is shown and kept, not silently rounded.
 */
const SELECT_CLASS =
  "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);

export function TimeField12({
  value,
  onChange,
  minuteStep = 5,
  disabled,
  id,
  "aria-label": ariaLabel = "Time",
  className,
}: {
  /** "HH:MM" 24-hour, or "" for none. */
  value: string;
  onChange: (next: string) => void;
  minuteStep?: number;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const parts = split12Hour(value);
  const empty = parts === null;

  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
  if (parts && !minutes.includes(parts.minute)) minutes.push(parts.minute);
  minutes.sort((a, b) => a - b);

  function emit(hour12: number, minute: number, meridiem: Meridiem) {
    onChange(to24HourString(hour12, minute, meridiem));
  }

  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex items-center gap-1.5", className)} id={id}>
      <select
        aria-label={`${ariaLabel} hour`}
        className={SELECT_CLASS}
        disabled={disabled}
        value={empty ? "" : String(parts.hour12)}
        onChange={(e) => {
          if (e.target.value === "") return onChange("");
          emit(Number(e.target.value), parts?.minute ?? 0, parts?.meridiem ?? "AM");
        }}
      >
        {empty && <option value="">—</option>}
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span aria-hidden className="text-muted-foreground">
        :
      </span>
      <select
        aria-label={`${ariaLabel} minute`}
        className={SELECT_CLASS}
        disabled={disabled || empty}
        value={empty ? "" : String(parts.minute)}
        onChange={(e) => parts && emit(parts.hour12, Number(e.target.value), parts.meridiem)}
      >
        {empty && <option value="">––</option>}
        {minutes.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select
        aria-label={`${ariaLabel} AM or PM`}
        className={SELECT_CLASS}
        disabled={disabled || empty}
        value={empty ? "" : parts.meridiem}
        onChange={(e) => parts && emit(parts.hour12, parts.minute, e.target.value as Meridiem)}
      >
        {empty && <option value="">––</option>}
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
