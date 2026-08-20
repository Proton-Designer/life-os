/**
 * Progressive-overload proposal — pure function, no React, no I/O.
 * docs/superpowers/specs/2026-08-19-fitness-redesign.md §2 ("progressive
 * overload becomes something the app proposes, not something he
 * remembers"), docs/superpowers/plans/2026-08-20-fitness-redesign.md
 * Phase 2.
 *
 * The increment is deliberately small and generic (his cable machine's
 * actual pin spacing is unknown to this library) — a placeholder pending
 * real equipment data, not a tuned value. Flagged rather than presented as
 * derived from anything.
 */

const DEFAULT_LOAD_INCREMENT_LB = 5;

export type LastTopSet = {
  load: number | null;
  reps: number;
  targetRepsHigh: number;
};

/**
 * Next session's proposed load off the last confirmed top set. Proposes an
 * increment only when the last top set hit (or exceeded) its target reps
 * range's high end; otherwise repeats the same load unchanged — the app
 * proposes progression, it does not force it onto a set that wasn't ready.
 *
 * Returns null when there is no history or the exercise is unloaded
 * (bodyweight — pull-ups, push-ups, dips without added weight): the caller
 * renders "—", never a fabricated number.
 */
export function proposeNextLoad(lastTopSet: LastTopSet | null): number | null {
  if (lastTopSet === null || lastTopSet === undefined) return null;

  const { load, reps, targetRepsHigh } = lastTopSet;
  if (load === null || load === undefined || !Number.isFinite(load)) return null;

  // Can't judge whether progression is warranted without a real reps
  // comparison — repeat the last known-good load rather than guess.
  if (!Number.isFinite(reps) || !Number.isFinite(targetRepsHigh)) return load;

  if (reps >= targetRepsHigh) return load + DEFAULT_LOAD_INCREMENT_LB;
  return load;
}
