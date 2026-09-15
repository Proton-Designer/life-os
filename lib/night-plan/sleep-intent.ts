/**
 * Sleep intent — "what time are you sleeping tonight," captured once per
 * local calendar day. Written in the SAME style as `night-plan.ts` (pure:
 * no clock, no Supabase, no React) per P2-05's own instruction, though the
 * shape here is deliberately much smaller than the dump/star/crown
 * ceremony — this is a single value with a validity rule, not a multi-
 * stage ritual with its own invariants to hold.
 *
 * DELIBERATELY DECOUPLED FROM THE EVENING CLOSE'S STAGE MACHINE
 * (lib/evening-close/close-stages.ts). That file is the enforced dump →
 * star → crown ORDER — a cross-cutting mechanism other code depends on
 * (lib/mcp/registry.ts, lib/school/school-today.ts) and whose own header
 * is explicit that widening it risks the exact silent-invariant-erosion
 * failure mode it was built to prevent ("the two-crown bug wearing
 * different clothes"). Sleep intent capture is a standalone widget
 * (components/home/sleep-intent-card.tsx) with no ordering dependency on
 * account/reflect/plan, so it stays outside that state machine entirely.
 */

export interface SleepIntentState {
  /** "HH:MM" 24h local clock time, or null when nothing has been set (or it was cleared) tonight. */
  intendedBedtime: string | null;
}

const BEDTIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether `time` is a well-formed "HH:MM" 24h clock string — the same rule migration 183's own CHECK constraint enforces at the DB layer (defense in depth, not the only guard). */
export function isValidBedtime(time: string): boolean {
  return BEDTIME_PATTERN.test(time);
}

/** Sets (or replaces) tonight's sleep intent. Refuses a malformed time by returning the state UNCHANGED — same "refuse rather than silently coerce" posture `night-plan.ts`'s own `star`/`crown` use for an invalid id. */
export function setSleepIntent(state: SleepIntentState, time: string): SleepIntentState {
  if (!isValidBedtime(time)) return state;
  return { intendedBedtime: time };
}

/** Clears tonight's intent — a deliberate "I don't want to set one" is a real state, not an error. */
export function clearSleepIntent(_state: SleepIntentState): SleepIntentState {
  return { intendedBedtime: null };
}
