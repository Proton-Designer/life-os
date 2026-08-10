"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeCheckinSlots } from "@/lib/checkins/compute-checkin-slots";
import { recordMissedCheckin, getCheckinOptionsForNow } from "@/app/(app)/checkin/actions";
import { localDateString } from "@/lib/date-utils";
import { CheckinPrompt } from "./checkin-prompt";
import type { CheckinOption } from "@/lib/checkins/types";

const SNOOZE_MS = 15 * 60 * 1000;
const POLL_MS = 60 * 1000;

export function CheckinScheduler({
  timezone,
  windowStart,
  windowEnd,
  intervalMinutes,
  pausedDate,
  answeredSlotTimesIso,
}: {
  timezone: string;
  windowStart: string;
  windowEnd: string;
  intervalMinutes: number;
  pausedDate: string | null;
  /** ISO strings of today's already-answered checkin_time values. */
  answeredSlotTimesIso: string[];
}) {
  const [dueSlot, setDueSlot] = useState<Date | null>(null);
  const [options, setOptions] = useState<CheckinOption[]>([]);
  const answeredRef = useRef(new Set(answeredSlotTimesIso.map((t) => new Date(t).getTime())));
  const recordedMissedRef = useRef(new Set<number>());
  const snoozedUntilRef = useRef<number | null>(null);
  const shownSlotRef = useRef<number | null>(null);

  const check = useCallback(async () => {
    const now = new Date();
    const todayStr = localDateString(now, timezone);
    const paused = pausedDate === todayStr;

    const result = computeCheckinSlots(windowStart, windowEnd, intervalMinutes, now, {
      timezone,
      answeredSlotTimes: [...answeredRef.current].map((t) => new Date(t)),
      paused,
    });

    for (const missed of result.missedSlots) {
      const t = missed.getTime();
      if (!recordedMissedRef.current.has(t)) {
        recordedMissedRef.current.add(t);
        recordMissedCheckin(missed.toISOString()).catch(() => {
          recordedMissedRef.current.delete(t); // retry on next poll if the write failed
        });
      }
    }

    if (!result.dueSlot) {
      setDueSlot(null);
      return;
    }

    const dueTime = result.dueSlot.getTime();
    if (snoozedUntilRef.current && Date.now() < snoozedUntilRef.current) return;
    if (shownSlotRef.current === dueTime) return; // already showing this slot

    shownSlotRef.current = dueTime;
    const opts = await getCheckinOptionsForNow(now.toISOString());
    setOptions(opts);
    setDueSlot(result.dueSlot);
  }, [windowStart, windowEnd, intervalMinutes, timezone, pausedDate]);

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_MS);
    return () => clearInterval(interval);
  }, [check]);

  if (!dueSlot) return null;

  return (
    <CheckinPrompt
      open
      checkinTime={dueSlot.toISOString()}
      intervalMinutes={intervalMinutes}
      options={options}
      onAnswered={() => {
        answeredRef.current.add(dueSlot.getTime());
        shownSlotRef.current = null;
        setDueSlot(null);
      }}
      onSnoozed={() => {
        snoozedUntilRef.current = Date.now() + SNOOZE_MS;
        shownSlotRef.current = null;
        setDueSlot(null);
      }}
    />
  );
}
