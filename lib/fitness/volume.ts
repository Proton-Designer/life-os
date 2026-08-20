/**
 * Weekly volume-per-muscle-group arithmetic — pure functions, no React, no
 * I/O. docs/superpowers/specs/2026-08-19-fitness-redesign.md §8,
 * docs/superpowers/plans/2026-08-20-fitness-redesign.md Phase 2.
 *
 * Fractional set crediting: primary mover = 1 set, secondary = 0.5. Best
 * predicted both hypertrophy and strength in the 2025 dose-response
 * meta-regression (Pelland et al.) — the spec's justification, not
 * re-derived here.
 *
 * RULING (the Lead, 2026-08-20): a muscle appearing in BOTH an entry's
 * primary and secondary arrays credits 1.0, not 1.5. It is one movement;
 * the primary classification wins and the secondary listing for that
 * muscle is ignored, not additive.
 */

export type MuscleGroup =
  | "chest"
  | "back_lats"
  | "back_mid"
  | "front_delt"
  | "side_delt"
  | "rear_delt"
  | "biceps"
  | "triceps"
  | "core";

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  "chest",
  "back_lats",
  "back_mid",
  "front_delt",
  "side_delt",
  "rear_delt",
  "biceps",
  "triceps",
  "core",
];

const MUSCLE_GROUP_SET: ReadonlySet<string> = new Set(MUSCLE_GROUPS);

export type SetEntry = {
  sets: number;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
};

function emptyVolume(): Record<MuscleGroup, number> {
  const result = {} as Record<MuscleGroup, number>;
  for (const m of MUSCLE_GROUPS) result[m] = 0;
  return result;
}

/**
 * Sanitizes a hostile `sets` value to a safe non-negative credit basis.
 * NaN, ±Infinity and negative values all become 0 (contribute nothing)
 * rather than propagating — an entry with garbage `sets` should not corrupt
 * every other entry's total the way an unguarded arithmetic op would.
 */
function sanitizeSets(sets: number): number {
  if (!Number.isFinite(sets)) return 0;
  if (sets <= 0) return 0;
  return sets;
}

/**
 * Fractional crediting per entry (spec §8): primary mover = 1 set,
 * secondary = 0.5. Returns a full record — every MuscleGroup key present,
 * zero where untouched, so callers never branch on undefined.
 *
 * An unrecognized muscle-group string (from a hostile or stale caller) is
 * ignored rather than credited to nothing or throwing — same
 * better-a-gap-than-a-wrong-total precedent as
 * `bucketAllocationMinutes` ignoring an unrecognized domain.
 */
export function weeklyVolume(entries: SetEntry[]): Record<MuscleGroup, number> {
  const result = emptyVolume();

  for (const entry of entries ?? []) {
    const sets = sanitizeSets(entry?.sets);
    if (sets <= 0) continue;

    // Set semantics collapse duplicate muscles within one array for free.
    const primary = new Set((entry.primaryMuscles ?? []).filter((m) => MUSCLE_GROUP_SET.has(m)));
    // Primary wins: a muscle listed in both arrays is dropped from
    // secondary here, so it is credited once at 1.0, not 1.0 + 0.5.
    const secondary = new Set(
      (entry.secondaryMuscles ?? []).filter((m) => MUSCLE_GROUP_SET.has(m) && !primary.has(m))
    );

    for (const m of primary) result[m as MuscleGroup] += sets;
    for (const m of secondary) result[m as MuscleGroup] += sets * 0.5;
  }

  return result;
}

/**
 * Count of entries whose muscle arrays are BOTH empty (or entirely
 * unrecognized strings) — these contribute nothing to `weeklyVolume` and
 * are surfaced here instead, so a caller can show a passive "N exercises
 * aren't counted in your volume" note without re-deriving the filter.
 */
export function untaggedCount(entries: SetEntry[]): number {
  let count = 0;
  for (const entry of entries ?? []) {
    const primary = (entry?.primaryMuscles ?? []).filter((m) => MUSCLE_GROUP_SET.has(m));
    const secondary = (entry?.secondaryMuscles ?? []).filter((m) => MUSCLE_GROUP_SET.has(m));
    if (primary.length === 0 && secondary.length === 0) count++;
  }
  return count;
}
