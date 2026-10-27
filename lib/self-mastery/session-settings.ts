import { MAX_SESSION_MINUTES_WITH_INTENSITY } from "./session/queue-limits";

// The two Self-Mastery session knobs on user_settings: how many brand-new cards a day may start, and how long a
// session is meant to run. Pure and client-safe so the Settings editor, the server action and the core share one
// definition of the rules.

export const DEFAULT_DAILY_NEW_LIMIT = 5; // column default (066)
export const MIN_DAILY_NEW_LIMIT = 0;
export const MAX_DAILY_NEW_LIMIT = 50; // user_settings_daily_new_limit_check

export const DEFAULT_SESSION_MINUTES = 8; // column default (066)
export const MIN_SESSION_MINUTES = 5;
// No CHECK on session_target_minutes in the database, so this range is enforced only here. The top is the session
// ceiling buildSession already applies under exam intensity, so a longer target would never be honoured anyway.
export const MAX_SESSION_MINUTES = MAX_SESSION_MINUTES_WITH_INTENSITY;

export type SelfMasterySessionSettings = { dailyNewLimit: number; sessionTargetMinutes: number };

const isWhole = (n: unknown, min: number, max: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** A readable refusal, or null when both values are acceptable. */
export function validateSelfMasterySettings(input: SelfMasterySessionSettings): string | null {
  if (!input || typeof input !== "object") return "Self-Mastery settings are missing.";
  if (!isWhole(input.dailyNewLimit, MIN_DAILY_NEW_LIMIT, MAX_DAILY_NEW_LIMIT)) {
    return `New cards per day must be a whole number from ${MIN_DAILY_NEW_LIMIT} to ${MAX_DAILY_NEW_LIMIT}.`;
  }
  if (!isWhole(input.sessionTargetMinutes, MIN_SESSION_MINUTES, MAX_SESSION_MINUTES)) {
    return `Daily session length must be a whole number of minutes from ${MIN_SESSION_MINUTES} to ${MAX_SESSION_MINUTES}.`;
  }
  return null;
}
