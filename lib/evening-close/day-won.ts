/**
 * Day Won (R58).
 *
 * FOUR OUTCOMES, NOT TWO, and that is the whole design. Collapsing them into
 * won/not-won turns "you never told me what a normal day looks like" and "you
 * planned to rest" both into "you failed" — a judgement the data does not
 * support, delivered at the end of the day to someone who is tired.
 *
 *   absent  no baselines stored: the user has never been asked
 *   rest    a baseline of 0 for today: a deliberate rest day
 *   won     hours >= today's baseline
 *   short   hours < today's baseline, with the gap
 *
 * `absent` is not `short` with a baseline of zero, and `rest` is not `won` with
 * a bar of zero. Both conflations would be invisible in the rendering and wrong
 * in the meaning.
 */

export type DayWonVerdict =
  | { kind: "absent" }
  | { kind: "rest" }
  | { kind: "won"; hoursMinutes: number; baselineHours: number }
  | { kind: "short"; hoursMinutes: number; baselineHours: number; shortByMinutes: number };

/**
 * @param hoursMinutes minutes of deep-work-class time today
 * @param baselines    `user_settings.weekday_baselines`, index 0 = Sunday. Null when never set.
 * @param weekdayIndex 0..6 for the USER'S today — computed in their timezone, never the server's
 */
export function dayWonVerdict(
  hoursMinutes: number,
  baselines: number[] | null,
  weekdayIndex: number
): DayWonVerdict {
  // Migration 122's CHECK makes a 7-length, null-free array the only storable
  // shape — but this is a separate entry point, and a malformed value must be
  // absent rather than read past its end or wrapped around.
  if (baselines === null) return { kind: "absent" };
  if (baselines.length !== 7) return { kind: "absent" };
  if (!Number.isInteger(weekdayIndex) || weekdayIndex < 0 || weekdayIndex > 6) return { kind: "absent" };

  const baselineHours = baselines[weekdayIndex];
  if (typeof baselineHours !== "number") return { kind: "absent" };

  // A deliberate rest day. Not a bar of zero that any amount of work clears —
  // "won" here would congratulate someone for working on the day they planned
  // not to.
  if (baselineHours === 0) return { kind: "rest" };

  const baselineMinutes = baselineHours * 60;
  if (hoursMinutes >= baselineMinutes) {
    return { kind: "won", hoursMinutes, baselineHours };
  }
  return {
    kind: "short",
    hoursMinutes,
    baselineHours,
    shortByMinutes: baselineMinutes - hoursMinutes,
  };
}
