"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DAILY,
  INTERVAL_MAX,
  INTERVAL_MIN,
  PER_MONTH_MAX,
  PER_WEEK_MAX,
  WEEKDAY_SHORT,
  describeFrequency,
  normalizeFrequency,
  type HabitFrequency,
  type HabitFrequencyKind,
} from "@/lib/habits/frequency";

/**
 * HABIT-FREQ: the one cadence picker, shared by the Faith Habit Builder (create + edit) and the /habits board (create +
 * edit), so a habit's frequency is chosen the same way everywhere.
 *
 * Controlled. `value` may be TRANSIENTLY invalid while the user is mid-edit (no weekday ticked yet, a count field
 * cleared) -- the picker never throws; callers gate their Save on `isFrequencyValid(value)` and hand the value to
 * `normalizeFrequency` (the same validator the server uses) before writing.
 */

const KIND_OPTIONS: { kind: HabitFrequencyKind; label: string }[] = [
  { kind: "daily", label: "Every day" },
  { kind: "weekdays", label: "Certain days" },
  { kind: "per_week", label: "Per week" },
  { kind: "per_month", label: "Per month" },
  { kind: "every_n_days", label: "Every…" },
];

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Monday-first reads naturally for picking days; the stored numbering stays 0 = Sunday.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function isFrequencyValid(f: HabitFrequency): boolean {
  try {
    normalizeFrequency(f);
    return true;
  } catch {
    return false;
  }
}

function defaultFor(kind: HabitFrequencyKind): HabitFrequency {
  switch (kind) {
    case "daily":
      return DAILY;
    case "weekdays":
      return { kind: "weekdays", days: [1, 3, 5] };
    case "per_week":
      return { kind: "per_week", count: 3 };
    case "per_month":
      return { kind: "per_month", count: 2 };
    case "every_n_days":
      return { kind: "every_n_days", interval: 3 };
  }
}

const PILL = (active: boolean) =>
  cn(
    "min-h-8 rounded-full border px-3 text-xs transition-colors",
    active ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:text-foreground"
  );

export function FrequencyPicker({
  value,
  onChange,
  disabled,
  idPrefix = "freq",
}: {
  value: HabitFrequency;
  onChange: (next: HabitFrequency) => void;
  disabled?: boolean;
  /** Distinguishes the field ids when two pickers are on screen at once. */
  idPrefix?: string;
}) {
  // "Every N days" is entered as days OR weeks; the stored value is always days. Initialised from the value so an
  // existing "every 2 weeks" reopens in weeks, and kept locally so typing "2" doesn't flip the unit under the user.
  const [unit, setUnit] = useState<"days" | "weeks">(value.kind === "every_n_days" && value.interval % 7 === 0 ? "weeks" : "days");

  const valid = isFrequencyValid(value);

  function pickKind(kind: HabitFrequencyKind) {
    if (kind === value.kind) return;
    if (kind === "every_n_days") setUnit("days");
    onChange(defaultFor(kind));
  }

  function toggleDay(day: number) {
    if (value.kind !== "weekdays") return;
    const days = value.days.includes(day) ? value.days.filter((d) => d !== day) : [...value.days, day].sort((a, b) => a - b);
    onChange({ kind: "weekdays", days });
  }

  function setCount(kind: "per_week" | "per_month", raw: string) {
    const n = raw === "" ? NaN : Number(raw);
    onChange({ kind, count: n } as HabitFrequency);
  }

  function setInterval_(raw: string, nextUnit: "days" | "weeks") {
    const n = raw === "" ? NaN : Number(raw);
    onChange({ kind: "every_n_days", interval: nextUnit === "weeks" ? n * 7 : n });
  }

  const intervalDisplay = value.kind === "every_n_days" ? (Number.isFinite(value.interval) ? String(unit === "weeks" ? value.interval / 7 : value.interval) : "") : "";

  return (
    <div className="flex flex-col gap-2" data-testid="frequency-picker">
      <div role="radiogroup" aria-label="How often" className="flex flex-wrap gap-1.5">
        {KIND_OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            role="radio"
            aria-checked={value.kind === o.kind}
            disabled={disabled}
            onClick={() => pickKind(o.kind)}
            className={PILL(value.kind === o.kind)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {value.kind === "weekdays" && (
        <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1.5">
          {DAY_ORDER.map((d) => {
            const on = value.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={DAY_FULL[d]}
                disabled={disabled}
                onClick={() => toggleDay(d)}
                className={cn(PILL(on), "min-w-11 px-2")}
              >
                {WEEKDAY_SHORT[d]}
              </button>
            );
          })}
        </div>
      )}

      {(value.kind === "per_week" || value.kind === "per_month") && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor={`${idPrefix}-count`}>
          <Input
            id={`${idPrefix}-count`}
            type="number"
            inputMode="numeric"
            min={1}
            max={value.kind === "per_week" ? PER_WEEK_MAX : PER_MONTH_MAX}
            value={Number.isFinite(value.count) ? String(value.count) : ""}
            disabled={disabled}
            onChange={(e) => setCount(value.kind as "per_week" | "per_month", e.target.value)}
            className="w-20"
            aria-label={value.kind === "per_week" ? "Times per week" : "Times per month"}
          />
          {value.kind === "per_week" ? "times each week, on any days" : "times each month, on any days"}
        </label>
      )}

      {value.kind === "every_n_days" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Every
          <Input
            type="number"
            inputMode="numeric"
            min={unit === "weeks" ? 1 : INTERVAL_MIN}
            max={unit === "weeks" ? Math.floor(INTERVAL_MAX / 7) : INTERVAL_MAX}
            value={intervalDisplay}
            disabled={disabled}
            onChange={(e) => setInterval_(e.target.value, unit)}
            className="w-20"
            aria-label={unit === "weeks" ? "Weeks between" : "Days between"}
          />
          <div role="radiogroup" aria-label="Unit" className="flex gap-1">
            {(["days", "weeks"] as const).map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={unit === u}
                disabled={disabled}
                onClick={() => {
                  if (u === unit) return;
                  // Keep the same number, change what it means: "3 days" -> "3 weeks".
                  const n = Number(intervalDisplay);
                  setUnit(u);
                  setInterval_(intervalDisplay === "" || !Number.isFinite(n) ? "" : String(n), u);
                }}
                className={PILL(unit === u)}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className={cn("text-xs", valid ? "text-muted-foreground" : "text-destructive")} data-testid="frequency-summary" aria-live="polite">
        {valid ? describeFrequency(normalizeFrequency(value)) : invalidMessage(value)}
      </p>
    </div>
  );
}

function invalidMessage(f: HabitFrequency): string {
  switch (f.kind) {
    case "weekdays":
      return "Pick at least one day.";
    case "per_week":
      return `Choose 1 to ${PER_WEEK_MAX} times a week (7 would be every day).`;
    case "per_month":
      return `Choose 1 to ${PER_MONTH_MAX} times a month.`;
    case "every_n_days":
      return `Choose ${INTERVAL_MIN} to ${INTERVAL_MAX} days (1 would be every day).`;
    default:
      return "Pick how often.";
  }
}
