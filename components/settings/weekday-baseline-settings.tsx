"use client";

import { useState, useTransition } from "react";
import { saveWeekdayBaselines, clearWeekdayBaselines } from "@/app/(app)/settings/weekday-baseline-actions";
import { Button } from "@/components/ui/button";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The weekday-baseline editor — a producer for `weekday_baselines` (122) until
 * A3's rhythm screen exists.
 *
 * IT MUST NOT COLLAPSE "NEVER SET" INTO "A WEEK OF ZEROS". CollegeOS Eng 1
 * raised this verifying the migration: the schema keeps those distinct, and
 * only the UI can preserve it. So:
 *
 *   * the unset state renders NO numbers at all — not a grid of zeros waiting
 *     to be saved, which is how an unanswered question becomes a considered
 *     answer of "rest every day" the first time someone taps Save
 *   * `0` is reachable as an explicit choice, never a default the form falls
 *     back to
 *   * Clear is its own action writing NULL, not "set everything to zero"
 *
 * The distinction is the entire reason 122 is nullable, and it would have been
 * destroyed at the first write by a form that defaulted to zeros.
 */
export function WeekdayBaselineSettings({ initial }: { initial: number[] | null }) {
  const [values, setValues] = useState<number[] | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function begin() {
    // 4h is a starting point for EDITING, not a stored value — nothing is
    // written until Save, so an abandoned edit leaves the column untouched.
    setValues([4, 4, 4, 4, 4, 4, 4]);
    setSaved(false);
  }

  function setDay(i: number, raw: string) {
    const n = Number.parseInt(raw, 10);
    setValues((prev) => {
      if (prev === null) return prev;
      const next = [...prev];
      next[i] = Number.isNaN(n) ? 0 : Math.min(12, Math.max(0, n));
      return next;
    });
    setSaved(false);
  }

  function save() {
    if (values === null) return;
    setError(null);
    startTransition(async () => {
      const res = await saveWeekdayBaselines(values);
      if ("error" in res) return setError(res.error);
      setSaved(true);
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const res = await clearWeekdayBaselines();
      if ("error" in res) return setError(res.error);
      setValues(null);
      setSaved(false);
    });
  }

  if (values === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No weekly shape set. The evening close shows your hours without a comparison.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={begin}>
          Set a weekly shape
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Target focus hours per day. <strong>0 means a deliberate rest day</strong> — it is never counted
        as a day lost.
      </p>
      <div className="grid grid-cols-7 gap-1.5">
        {DAYS.map((d, i) => (
          <label key={d} className="flex flex-col items-center gap-1">
            <span className="text-[11px] text-muted-foreground">{d}</span>
            <input
              type="number"
              min={0}
              max={12}
              inputMode="numeric"
              aria-label={`${d} target hours`}
              value={values[i]}
              onChange={(e) => setDay(i, e.target.value)}
              className="h-10 w-full rounded-md border bg-transparent text-center text-sm"
            />
          </label>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {saved ? "Saved" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={pending}>
          Clear
        </Button>
      </div>
    </div>
  );
}
