/**
 * The wind-down plan (IA-P4a): three set-once inputs (user_settings.wake_time /
 * sleep_need_minutes / wind_down_minutes) and everything else DERIVED, never stored, so it can't
 * drift from them. Pure and client-safe (no server-only): the Settings card previews it live.
 *   bedtime        = wake_time - sleep_need           (wraps past midnight)
 *   wind-down start = bedtime - wind_down_minutes     (wraps too)
 * All values are local "HH:MM" clock strings in the user's own zone — no Date, no UTC.
 */
export const DEFAULT_WIND_DOWN_MINUTES = 45;
export const SLEEP_NEED_RANGE = { min: 360, max: 600 } as const;
export const WIND_DOWN_RANGE = { min: 15, max: 120 } as const;
const DAY = 24 * 60;

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export function isHHMM(v: unknown): v is string {
  return typeof v === "string" && HHMM.test(v);
}

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}
function fromMinutes(total: number): string {
  const m = ((total % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type WindDownPlan = { bedtime: string; windDownStart: string; windDownMinutes: number };
export type WindDownInputs = { wakeTime: string | null; sleepNeedMinutes: number | null; windDownMinutes: number | null };

/** null when the plan isn't set (or an input is out of range) — callers fall back to their default (Home 21:00, reminder 21:30). */
export function deriveWindDown(input: WindDownInputs): WindDownPlan | null {
  const { wakeTime, sleepNeedMinutes } = input;
  if (!isHHMM(wakeTime) || sleepNeedMinutes === null) return null;
  if (!Number.isInteger(sleepNeedMinutes) || sleepNeedMinutes < SLEEP_NEED_RANGE.min || sleepNeedMinutes > SLEEP_NEED_RANGE.max) return null;
  const windDownMinutes = input.windDownMinutes ?? DEFAULT_WIND_DOWN_MINUTES;
  if (!Number.isInteger(windDownMinutes) || windDownMinutes < WIND_DOWN_RANGE.min || windDownMinutes > WIND_DOWN_RANGE.max) return null;
  const bedtimeMin = toMinutes(wakeTime) - sleepNeedMinutes;
  return { bedtime: fromMinutes(bedtimeMin), windDownStart: fromMinutes(bedtimeMin - windDownMinutes), windDownMinutes };
}

/** Validates user input for saving; returns an error message or null. */
export function validateWindDownInputs(input: { wakeTime: string; sleepNeedMinutes: number; windDownMinutes: number }): string | null {
  if (!isHHMM(input.wakeTime)) return "Enter your wake time as HH:MM (24-hour).";
  if (!Number.isInteger(input.sleepNeedMinutes) || input.sleepNeedMinutes < SLEEP_NEED_RANGE.min || input.sleepNeedMinutes > SLEEP_NEED_RANGE.max) {
    return "Sleep need must be between 6 and 10 hours.";
  }
  if (!Number.isInteger(input.windDownMinutes) || input.windDownMinutes < WIND_DOWN_RANGE.min || input.windDownMinutes > WIND_DOWN_RANGE.max) {
    return "Wind-down must start 15 to 120 minutes before bedtime.";
  }
  return null;
}

/**
 * "Lights out by HH:MM" is the BEDTIME; the reminder/Home card fire at windDownStart. A wind-down
 * start that lands before 12:00 local (e.g. a 06:00 waker with a long wind-down could land at
 * 20:15, but a 12:00 waker lands at 04:15) is not an evening time; callers should ignore such a
 * plan for the evening card/reminder and use their default. Returns the start only when it is
 * between 15:00 and 23:59 local.
 */
export function eveningWindDownStart(plan: WindDownPlan | null): string | null {
  if (!plan) return null;
  const m = toMinutes(plan.windDownStart);
  return m >= 15 * 60 ? plan.windDownStart : null;
}
