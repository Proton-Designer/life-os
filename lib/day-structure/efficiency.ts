export type Efficiency = {
  /**
   * Raw ratio, uncapped. Can exceed 1 — if focused minutes were logged
   * before today's wake mark was tapped (Start Day tapped late, after work
   * already started), the numerator legitimately outgrows the denominator.
   * Kept on the returned value rather than silently clamped away, so a
   * caller that wants to explain "127%" rather than hide it still can.
   */
  fraction: number;
  /**
   * Display-clamped to [0, 100] — the KPI reads as "how much of the day
   * awake was focused", and a raw ">100%" on a stat tile reads as broken
   * math to someone glancing at it, not as an interesting edge case.
   */
  percent: number;
};

/**
 * Efficiency (#35) = focused minutes today ÷ minutes since wake.
 *
 * DERIVED, NEVER STORED, same reasoning as computeDeltaMinutes
 * (lib/day-structure/delta-clock.ts): both inputs are themselves derived
 * or read fresh at request time — hoursTodayMinutes from the day-bounded
 * work_sessions query (lib/evening-close/hours-today.ts,
 * counts_toward_hours-filtered), deltaMinutes from #34 — so storing a
 * third value computed from two already-fresh ones would be the one write
 * path in this feature with nothing forcing it to stay in sync with either
 * input changing.
 *
 * Returns null when there is no meaningful denominator (`deltaMinutes <=
 * 0` — no wake mark yet today, or one was just set this instant) rather
 * than 0 or a divide-by-zero Infinity: "0% efficient" would assert a real,
 * bad answer to a question that hasn't been asked yet — the same
 * absent-is-not-a-value distinction lib/evening-close/day-won.ts draws
 * between `{kind: "absent"}` and a real baseline of zero.
 */
export function computeEfficiency(hoursTodayMinutes: number, deltaMinutes: number): Efficiency | null {
  if (deltaMinutes <= 0) return null;
  const fraction = hoursTodayMinutes / deltaMinutes;
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return { fraction, percent };
}
