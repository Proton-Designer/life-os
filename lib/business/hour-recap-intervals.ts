import type { ResolvedSessionHour } from "@/lib/checkins/session-hour-status";
import type { HourWorkInterval } from "@/lib/reflection-cards/types";
import type { WorkSessionKind } from "@/lib/business/work-session-kind";

/**
 * P3-05's End-of-Hour ritual entry point (components/business/end-of-hour-
 * reflection.tsx) needs one `HourWorkInterval` per computeHourRecapCore's
 * own contract (lib/reflection-cards/end-of-hour-core.ts) -- "already-
 * fetched, real work-session data for the last 60 minutes... the caller's
 * own concern, not this action's." This is that caller-side concern for
 * the ONE place in this codebase that already tracks Lock-In hours as
 * discrete, classified 60-minute slots: lib/checkins/session-hour-status.ts's
 * `resolveSessionHours`.
 *
 * Deliberately just the MOST RECENT resolved hour, not the whole session --
 * the ritual fires at "the Hour" completing, and its recap is meant to be
 * about that one hour, not a running total the session's own UI already
 * shows elsewhere (the Signal:Noise ratio, the hour list).
 *
 * `resolved` is trusted to already be sorted oldest-first (resolveSessionHours's
 * own contract -- it sorts before returning) -- this reads the last element
 * rather than re-sorting.
 */
export function mostRecentHourAsInterval(
  resolved: readonly Pick<ResolvedSessionHour, "state">[],
  kind: WorkSessionKind
): HourWorkInterval[] {
  if (resolved.length === 0) return [];
  const last = resolved[resolved.length - 1]!;
  return [{ domain: kind, minutes: 60, isDistraction: last.state !== "confirmed_business" }];
}
