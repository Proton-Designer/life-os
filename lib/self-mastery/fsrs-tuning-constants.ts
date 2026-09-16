/**
 * P3-20 -- the FSRS-tuning gate threshold, needed by BOTH
 * lib/self-mastery/fsrs-tuning.ts (a `"server-only"` module) and
 * components/self-mastery/fsrs-tuning-card.tsx (a `"use client"`
 * component). Deliberately its own file, without `import "server-only"`,
 * so the client component can import this real runtime value directly --
 * same established pattern as lib/habits/constants.ts and
 * lib/morning-routine/constants.ts, after that exact class of import
 * broke a production build once (b63600b).
 */
export const FSRS_TUNING_MIN_REVIEWS = 1000;
