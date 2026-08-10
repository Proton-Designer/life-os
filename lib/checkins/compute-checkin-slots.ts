import { localDateString, resolveLocalTime } from "@/lib/date-utils";

export type CheckinSlotsResult = {
  /** Every fixed check-in time for today, in order. */
  slots: Date[];
  /** The single most-recent fired-but-unanswered slot — answerable right now. */
  dueSlot: Date | null;
  /** Earlier fired-but-unanswered slots, now superseded and locked as missed. */
  missedSlots: Date[];
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Fixed clock-time check-in slots within [windowStart, windowEnd], stepping
 * by intervalMinutes, per spec ("fixed clock times, not app-open-relative").
 * Also evaluates grace-period state: the most recent fired-but-unanswered
 * slot is "due" (still answerable); anything fired-but-unanswered before
 * that is "missed" (locked out once a newer slot has fired).
 */
export function computeCheckinSlots(
  windowStart: string,
  windowEnd: string,
  intervalMinutes: number,
  now: Date,
  options: {
    timezone: string;
    answeredSlotTimes: Date[];
    paused: boolean;
  }
): CheckinSlotsResult {
  if (options.paused) {
    return { slots: [], dueSlot: null, missedSlots: [] };
  }

  const dateStr = localDateString(now, options.timezone);
  const startMin = toMinutes(windowStart);
  const endMin = toMinutes(windowEnd);

  const slots: Date[] = [];
  for (let t = startMin; t <= endMin; t += intervalMinutes) {
    const hh = String(Math.floor(t / 60)).padStart(2, "0");
    const mm = String(t % 60).padStart(2, "0");
    slots.push(resolveLocalTime(dateStr, `${hh}:${mm}`, options.timezone));
  }

  const answeredTimes = new Set(options.answeredSlotTimes.map((d) => d.getTime()));
  const firedUnanswered = slots.filter(
    (s) => s.getTime() <= now.getTime() && !answeredTimes.has(s.getTime())
  );

  if (firedUnanswered.length === 0) {
    return { slots, dueSlot: null, missedSlots: [] };
  }

  const dueSlot = firedUnanswered[firedUnanswered.length - 1];
  const missedSlots = firedUnanswered.slice(0, -1);

  return { slots, dueSlot, missedSlots };
}
