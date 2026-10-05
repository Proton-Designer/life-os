"use client";

import { useState, useTransition } from "react";
import { saveFocusTargets } from "@/app/(app)/settings/focus-target-actions";
import {
  DEFAULT_FOCUS_TARGET_MINUTES,
  formatTargetHours,
  validateFocusTargets,
  type FocusTargetSettings,
} from "@/lib/focus/target";

function split(minutes: number): { h: string; m: string } {
  return { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) };
}

function total(h: string, m: string): number {
  return Math.round(Number(h || 0)) * 60 + Math.round(Number(m || 0));
}

function TimeFields({ label, h, m, onH, onM }: { label: string; h: string; m: string; onH: (v: string) => void; onM: (v: string) => void }) {
  return (
    <div className="flex items-end gap-2" role="group" aria-label={label}>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}: hours</span>
        <input type="number" min={0} max={12} step={1} value={h} onChange={(e) => onH(e.target.value)} aria-label={`${label} hours`} className="h-9 w-20 rounded-md border bg-background px-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">minutes</span>
        <input type="number" min={0} max={59} step={5} value={m} onChange={(e) => onM(e.target.value)} aria-label={`${label} minutes`} className="h-9 w-20 rounded-md border bg-background px-2" />
      </label>
    </div>
  );
}

/**
 * HOME-01a: the "N of 4 Hours today" target on Home, adjustable. Weekday (every day unless a weekend
 * target is set) and an optional different Saturday/Sunday target. The save is optimistic: "Saved" shows
 * at once and flips to the error if the write is refused. Not gated by any opt-in.
 */
export function FocusTargetSettings({ initial }: { initial: FocusTargetSettings }) {
  const daily = split(initial.dailyMinutes ?? DEFAULT_FOCUS_TARGET_MINUTES);
  const weekend = split(initial.weekendMinutes ?? initial.dailyMinutes ?? DEFAULT_FOCUS_TARGET_MINUTES);
  const [dh, setDh] = useState(daily.h);
  const [dm, setDm] = useState(daily.m);
  const [useWeekend, setUseWeekend] = useState(initial.weekendMinutes !== null);
  const [wh, setWh] = useState(weekend.h);
  const [wm, setWm] = useState(weekend.m);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const dailyMinutes = total(dh, dm);
  const weekendMinutes = total(wh, wm);

  function save(next: FocusTargetSettings) {
    const invalid = validateFocusTargets(next);
    if (invalid) {
      setMessage({ ok: false, text: invalid });
      return;
    }
    setMessage({ ok: true, text: "Saved." }); // optimistic
    startTransition(async () => {
      const res = await saveFocusTargets(next);
      if (!res.ok) setMessage({ ok: false, text: res.message });
    });
  }

  function useDefault() {
    const d = split(DEFAULT_FOCUS_TARGET_MINUTES);
    setDh(d.h);
    setDm(d.m);
    setUseWeekend(false);
    save({ dailyMinutes: null, weekendMinutes: null });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="focus-target-settings">
      <p className="text-xs text-muted-foreground">
        The goal behind &ldquo;N of {formatTargetHours(DEFAULT_FOCUS_TARGET_MINUTES)} Hours today&rdquo; on Home. One Hour is 60 minutes of counted focus time.
      </p>
      <TimeFields label="Daily target" h={dh} m={dm} onH={setDh} onM={setDm} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useWeekend} onChange={(e) => setUseWeekend(e.target.checked)} aria-label="Different target on weekends" />
        Different target on weekends (Sat &amp; Sun)
      </label>
      {useWeekend && <TimeFields label="Weekend target" h={wh} m={wm} onH={setWh} onM={setWm} />}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => save({ dailyMinutes, weekendMinutes: useWeekend ? weekendMinutes : null })}
          className="h-9 rounded-md border px-3"
        >
          Save target
        </button>
        <button type="button" onClick={useDefault} className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:underline">
          Use default ({formatTargetHours(DEFAULT_FOCUS_TARGET_MINUTES)} h)
        </button>
        {message && (
          <span role="status" className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
