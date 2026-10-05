"use client";

import { useState, useTransition } from "react";
import { saveWindDownPlan } from "@/app/(app)/settings/wind-down-actions";
import { formatHHMM12 } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";

/**
 * Weekly review, Sleep plan ON: when the Start Day marks say your real mornings run clearly later than the planned wake
 * time, say so plainly and offer ONE tap to move the plan to match (bedtime, wind-down and the reminder all follow from
 * the wake time). No score, no scolding -- the plan should fit the person, so the offer is to change the plan.
 */
export function WakePlanNudge({
  plannedWake,
  suggestedWake,
  lateDays,
  n,
  minutesLate,
  sleepNeedMinutes,
  windDownMinutes,
}: {
  plannedWake: string;
  suggestedWake: string;
  lateDays: number;
  n: number;
  minutesLate: number;
  sleepNeedMinutes: number;
  windDownMinutes: number | null;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [applied, setApplied] = useState(false);

  function apply() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveWindDownPlan({ wakeTime: suggestedWake, sleepNeedMinutes, ...(windDownMinutes !== null ? { windDownMinutes } : {}) });
      if (res.ok) {
        setApplied(true);
        setMessage({ ok: true, text: `Done. Wake ${formatHHMM12(suggestedWake)}, lights out by ${formatHHMM12(res.bedtime)}, wind-down at ${formatHHMM12(res.windDownStart)}.` });
      } else {
        setMessage({ ok: false, text: res.message });
      }
    });
  }

  const hours = Math.floor(minutesLate / 60);
  const mins = minutesLate % 60;
  const lateText = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ""}` : `${mins} min`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4" data-testid="wake-plan-nudge">
      <p className="text-sm">
        Your mornings have started about <span className="font-medium">{lateText}</span> after your planned wake time ({formatHHMM12(plannedWake)}) — {lateDays} of {n} mornings.
      </p>
      {!applied ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={apply} disabled={pending} data-testid="wake-plan-adjust">
            Move my wake time to {formatHHMM12(suggestedWake)}
          </Button>
          <span className="text-xs text-muted-foreground">Or leave it as is.</span>
        </div>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
