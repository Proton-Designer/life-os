"use client";

import { useState, useTransition } from "react";
import { saveWindDownPlan } from "@/app/(app)/settings/wind-down-actions";
import { DEFAULT_WIND_DOWN_MINUTES, deriveWindDown, validateWindDownInputs } from "@/lib/rhythm/wind-down";
import { formatHHMM12 } from "@/lib/date-utils";
import { TimeField12 } from "@/components/ui/time-field-12";

/**
 * The set-once wind-down plan (IA-P4a, Sleep plan opt-in): when you want to be up, how long you
 * need, how long before bed the wind-down starts. Bedtime and wind-down start are shown live and
 * DERIVED — never typed nightly. They feed Home's "Close the day" card and the reminder push.
 */
export function WindDownPlanSettings({
  initialWakeTime,
  initialSleepNeedMinutes,
  initialWindDownMinutes,
}: {
  initialWakeTime: string | null;
  initialSleepNeedMinutes: number | null;
  initialWindDownMinutes: number | null;
}) {
  const [wake, setWake] = useState(initialWakeTime ?? "");
  const [needHours, setNeedHours] = useState(initialSleepNeedMinutes ? String(initialSleepNeedMinutes / 60) : "8");
  const [windDown, setWindDown] = useState(String(initialWindDownMinutes ?? DEFAULT_WIND_DOWN_MINUTES));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const needMinutes = Math.round(Number(needHours) * 60);
  const windMinutes = Number(windDown);
  const preview = deriveWindDown({ wakeTime: wake || null, sleepNeedMinutes: Number.isFinite(needMinutes) ? needMinutes : null, windDownMinutes: Number.isFinite(windMinutes) ? windMinutes : null });

  function save() {
    const invalid = validateWindDownInputs({ wakeTime: wake, sleepNeedMinutes: needMinutes, windDownMinutes: windMinutes });
    if (invalid) {
      setMessage({ ok: false, text: invalid });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await saveWindDownPlan({ wakeTime: wake, sleepNeedMinutes: needMinutes, windDownMinutes: windMinutes });
      setMessage(res.ok ? { ok: true, text: `Saved. Lights out by ${formatHHMM12(res.bedtime)}; wind-down starts ${formatHHMM12(res.windDownStart)}.` } : { ok: false, text: res.message });
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="wind-down-plan-settings">
      <p className="text-xs text-muted-foreground">Set once — no nightly question. Your bedtime and wind-down time follow from these.</p>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Wake time</span>
          <TimeField12 value={wake} onChange={setWake} aria-label="Wake time" />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Sleep I need (hours)</span>
          <input type="number" min={6} max={10} step={0.25} value={needHours} onChange={(e) => setNeedHours(e.target.value)} aria-label="Sleep need in hours" className="h-9 w-24 rounded-md border bg-background px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Wind down (min before bed)</span>
          <input type="number" min={15} max={120} step={5} value={windDown} onChange={(e) => setWindDown(e.target.value)} aria-label="Wind-down minutes" className="h-9 w-24 rounded-md border bg-background px-2" />
        </label>
        <button type="button" onClick={save} disabled={pending} className="h-9 rounded-md border px-3 disabled:opacity-50">
          Save
        </button>
      </div>
      {preview ? (
        <p className="text-sm" data-testid="wind-down-preview">
          Lights out by <span className="font-medium">{formatHHMM12(preview.bedtime)}</span> · wind-down starts <span className="font-medium">{formatHHMM12(preview.windDownStart)}</span>
        </p>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
