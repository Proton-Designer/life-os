/**
 * P3-05 -- shared shapes for the cards library + End-of-Hour ritual.
 * `reflection_cards`/`end_of_hour_reflections` (migration TBD, requested
 * from the Lead) mirror this shape exactly once applied; these types exist
 * ahead of the migration so the pure math in `end-of-hour-core.ts` can be
 * written and tested without a live schema.
 */

export const REFLECTION_CARD_KINDS = ["goal", "motivation", "thought_habit", "trait"] as const;
export type ReflectionCardKind = (typeof REFLECTION_CARD_KINDS)[number];

export function isReflectionCardKind(value: string): value is ReflectionCardKind {
  return (REFLECTION_CARD_KINDS as readonly string[]).includes(value);
}

export interface ReflectionCard {
  id: string;
  userId: string;
  kind: ReflectionCardKind;
  content: string;
  active: boolean;
  /** Null means never shown -- counts as the oldest possible for rotation purposes. */
  lastShownAt: string | null;
  createdAt: string;
}

/** A single already-logged work interval, as already fetched from wherever the caller sources the last-60-minutes window (lock-in session hours / work sessions) -- `computeHourRecapCore` does no fetching of its own, it only summarizes rows handed to it. */
export interface HourWorkInterval {
  domain: string;
  minutes: number;
  /** True when this interval was logged as a distraction/off-task segment, not real work. */
  isDistraction: boolean;
}

export interface HourRecap {
  totalMinutes: number;
  workMinutes: number;
  distractionCount: number;
  /** Minutes per domain, real work only (distractions excluded) -- empty when nothing was logged in the window. */
  byDomain: Record<string, number>;
}
