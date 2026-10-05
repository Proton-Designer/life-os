"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { setUpDay } from "@/app/(app)/day-setup/actions";
import { DEFAULT_WIND_DOWN_MINUTES, deriveWindDown, validateWindDownInputs } from "@/lib/rhythm/wind-down";
import { MAX_SETUP_STEPS } from "@/lib/day-setup/limits";
import { formatHHMM12 } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeField12 } from "@/components/ui/time-field-12";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SNOOZE_KEY = "lifeos:day-setup-snooze-until";
const SNOOZE_DAYS = 14;

function readSnoozedUntil(): number {
  try {
    return Number(window.localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0; // storage blocked: just show the offer
  }
}

// A tiny external store over the snooze flag: the server (and the first client render) read "snoozed" so nothing flashes
// or mismatches hydration, and the real value takes over right after. Cross-tab changes arrive via the storage event.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const isSnoozed = () => readSnoozedUntil() > Date.now();

/**
 * One-time offer on Home's "Done for today" card (the calm end-of-night moment) to set up the sleep plan and an optional
 * morning routine in a single short flow, instead of finding two opt-ins in Settings. The parent only renders this while
 * NEITHER feature is on, so it disappears for good once set up. "Not now" snoozes it for two weeks (per browser: the
 * snooze is a convenience, not state anyone else needs, so it deliberately has no database column).
 */
export function DaySetupCard() {
  const hidden = useSyncExternalStore(subscribe, isSnoozed, () => true);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function notNow() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
      /* storage blocked: it will simply be offered again next time */
    }
    listeners.forEach((cb) => cb());
  }

  if (done) {
    return (
      <p role="status" className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="day-setup-done">
        {done}
      </p>
    );
  }
  if (hidden) return null;

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border/60 p-3" data-testid="day-setup-card">
      <p className="text-sm font-medium">Make tomorrow morning smoother</p>
      <p className="text-xs text-muted-foreground">One minute: when you want to wake, and a small routine to start the day. Everything adjusts from there.</p>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid="day-setup-open">
          Set up your day
        </Button>
        <button type="button" onClick={notNow} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" data-testid="day-setup-later">
          Not now
        </button>
      </div>
      <DaySetupDialog open={open} onOpenChange={setOpen} onSaved={(msg) => setDone(msg)} />
    </div>
  );
}

function DaySetupDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: (message: string) => void }) {
  const [wake, setWake] = useState("");
  const [needHours, setNeedHours] = useState("8");
  const [windDown, setWindDown] = useState(String(DEFAULT_WIND_DOWN_MINUTES));
  const [steps, setSteps] = useState<string[]>(Array.from({ length: MAX_SETUP_STEPS }, () => ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needMinutes = Math.round(Number(needHours) * 60);
  const windMinutes = Number(windDown);
  const invalid = wake === "" ? "Pick the time you want to wake up." : validateWindDownInputs({ wakeTime: wake, sleepNeedMinutes: needMinutes, windDownMinutes: windMinutes });
  const preview = invalid ? null : deriveWindDown({ wakeTime: wake, sleepNeedMinutes: needMinutes, windDownMinutes: windMinutes });

  function save() {
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const res = await setUpDay({ wakeTime: wake, sleepNeedMinutes: needMinutes, windDownMinutes: windMinutes, routineSteps: steps });
      if (!res.ok) return setError(res.message);
      onOpenChange(false);
      onSaved(
        `All set. Lights out by ${formatHHMM12(res.bedtime)}, wind-down at ${formatHHMM12(res.windDownStart)}` +
          (res.stepsCreated > 0 ? `, and your morning routine will be on Home tomorrow.` : ".")
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto" data-testid="day-setup-dialog">
        <DialogHeader>
          <DialogTitle>Set up your day</DialogTitle>
          <DialogDescription>Set once. Your bedtime, the wind-down reminder and the morning card all follow from this.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">I want to wake up at</span>
          <TimeField12 value={wake} onChange={setWake} aria-label="Wake time" disabled={pending} />
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Sleep I need (hours)
            <Input type="number" min={6} max={10} step={0.25} value={needHours} onChange={(e) => setNeedHours(e.target.value)} aria-label="Sleep need in hours" className="w-28" disabled={pending} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Wind down (min before bed)
            <Input type="number" min={15} max={120} step={5} value={windDown} onChange={(e) => setWindDown(e.target.value)} aria-label="Wind-down minutes" className="w-28" disabled={pending} />
          </label>
        </div>
        {preview ? (
          <p className="text-sm" data-testid="day-setup-preview">
            Lights out by <span className="font-medium">{formatHHMM12(preview.bedtime)}</span> · wind-down starts <span className="font-medium">{formatHHMM12(preview.windDownStart)}</span>
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">A small morning routine (optional, up to {MAX_SETUP_STEPS})</span>
          {steps.map((s, i) => (
            <Input
              key={i}
              value={s}
              maxLength={120}
              placeholder={["e.g. Drink a glass of water", "e.g. Stretch for two minutes", "e.g. Read one page"][i]}
              aria-label={`Morning step ${i + 1}`}
              onChange={(e) => setSteps((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              disabled={pending}
            />
          ))}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending || invalid !== null} data-testid="day-setup-save">
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
