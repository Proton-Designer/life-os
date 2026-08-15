export type SessionCheckinSlotsResult = {
  /** Every session-relative check-in slot fired so far, in order. */
  slots: Date[];
  /** The single most-recent fired-but-unanswered slot — answerable right now. */
  dueSlot: Date | null;
  /** Earlier fired-but-unanswered slots, now superseded and locked as missed. */
  missedSlots: Date[];
};

/**
 * Session-relative check-in slots: started_at + N*intervalMinutes for
 * N=1,2,3..., unbounded end (keeps going as long as the session stays
 * active) — as opposed to compute-checkin-slots.ts's fixed daily
 * clock-time slots. Same grace-period handling: the most recent
 * fired-but-unanswered slot is "due"; anything fired-but-unanswered before
 * that is "missed" (locked out once a newer slot has fired).
 */
export function computeSessionCheckinSlots(
  startedAt: Date,
  intervalMinutes: number,
  now: Date,
  answeredSlotTimes: Date[]
): SessionCheckinSlotsResult {
  const intervalMs = intervalMinutes * 60_000;
  const slots: Date[] = [];
  for (let t = startedAt.getTime() + intervalMs; t <= now.getTime(); t += intervalMs) {
    slots.push(new Date(t));
  }

  const answeredTimes = new Set(answeredSlotTimes.map((d) => d.getTime()));
  const firedUnanswered = slots.filter((s) => !answeredTimes.has(s.getTime()));

  if (firedUnanswered.length === 0) {
    return { slots, dueSlot: null, missedSlots: [] };
  }

  const dueSlot = firedUnanswered[firedUnanswered.length - 1];
  const missedSlots = firedUnanswered.slice(0, -1);

  return { slots, dueSlot, missedSlots };
}
