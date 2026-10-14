/** Pure rules for fixing a Deep Work / Deep Study session that was left running (shared by the server core and the dialog). */

export const MIN_SESSION_MINUTES = 1;

/** A session this long (or well past its own plan) is flagged on Insights as probably left running. */
export function looksLeftRunning(durationMinutes: number, goalMinutes: number | null): boolean {
  if (durationMinutes >= 4 * 60) return true;
  return goalMinutes !== null && durationMinutes >= Math.max(goalMinutes * 2, goalMinutes + 90);
}

export type CorrectionCheck = { ok: true; endedAtIso: string; newSeconds: number } | { ok: false; message: string };

/** The corrected length (minutes) must be a whole number of at least 1 and strictly shorter than what is stored. */
export function checkCorrectedLength(startedAtIso: string, endedAtIso: string, minutes: number): CorrectionCheck {
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < MIN_SESSION_MINUTES) {
    return { ok: false, message: "Enter the real length in whole minutes (at least 1)." };
  }
  const start = new Date(startedAtIso).getTime();
  const oldEnd = new Date(endedAtIso).getTime();
  const newEnd = start + minutes * 60_000;
  if (newEnd >= oldEnd) return { ok: false, message: "That's not shorter than the recorded time." };
  return { ok: true, endedAtIso: new Date(newEnd).toISOString(), newSeconds: minutes * 60 };
}
