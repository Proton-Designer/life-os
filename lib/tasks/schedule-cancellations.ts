import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export type CancelledDatesByEvent = Map<string, Set<string>>;

/**
 * The single source of truth for "is this recurring event's occurrence on
 * `date` cancelled." `schedule_events.cancelled_on` is deprecated (migration
 * 046) — a single nullable date column that silently un-cancelled a prior
 * cancellation the moment a second one was recorded, and rendered a
 * cancelled occurrence as simply absent, indistinguishable from one that
 * was never entered. Every reader (School, Work, Day's Shape, the calendar
 * popup) fetches and checks cancellation state through this same pair of
 * functions rather than hand-rolling a lookup against `cancelled_on`.
 *
 * Kept as its own narrow pair of functions for readers that only ever need
 * a yes/no cancelled check (Day's Shape, the calendar popup) — see
 * `getScheduleExceptions`/`resolveOccurrence` below for readers that also
 * need to know about a temporary hours override (item 4, 2026-08-26 night
 * batch 2).
 */
export async function getCancelledDatesByEvent(
  supabase: TypedClient,
  userId: string,
  eventIds: string[]
): Promise<CancelledDatesByEvent> {
  const map: CancelledDatesByEvent = new Map();
  if (eventIds.length === 0) return map;

  const { data, error } = await supabase
    .from("schedule_event_cancellations")
    .select("event_id, date")
    .eq("user_id", userId)
    .in("event_id", eventIds);
  if (error) throw error;

  for (const row of data ?? []) {
    const set = map.get(row.event_id) ?? new Set<string>();
    set.add(row.date);
    map.set(row.event_id, set);
  }
  return map;
}

export function isOccurrenceCancelled(cancelledDates: CancelledDatesByEvent, eventId: string, date: string): boolean {
  return cancelledDates.get(eventId)?.has(date) ?? false;
}

// ---------------------------------------------------------------------
// Full occurrence resolution — cancellation AND temporary-hours-override
// awareness, in one place (Opus Lead ruling, item 4). A date can carry
// BOTH a cancellation and an override at once (see the write-side rules
// on setScheduleEventOverrideCore/cancelScheduleOccurrenceCore in
// actions-core.ts), so the two facts are tracked independently per
// (event_id, date) rather than collapsed into one signal at fetch time —
// only `resolveOccurrence` applies the display precedence. Every reader
// that needs to know "what actually happens on this occurrence" (School's
// ClassScheduleWeek, Work's WorkScheduleWeek, schedule-metrics's weekly
// count) calls this pair, not a second independent lookup — the exact
// six-readers-drifted-independently shape that made `cancelled_on` a bug
// in the first place must not recur one layer up.
// ---------------------------------------------------------------------

export type OccurrenceException = {
  cancelled: boolean;
  override: { eventTime: string; endTime: string | null } | null;
};
export type ExceptionsByEvent = Map<string, Map<string, OccurrenceException>>;

export type ResolvedOccurrence =
  | { kind: "cancelled" }
  | { kind: "override"; eventTime: string; endTime: string | null }
  | { kind: "normal" };

export async function getScheduleExceptions(
  supabase: TypedClient,
  userId: string,
  eventIds: string[]
): Promise<ExceptionsByEvent> {
  const map: ExceptionsByEvent = new Map();
  if (eventIds.length === 0) return map;

  function entryFor(eventId: string, date: string): OccurrenceException {
    const byDate = map.get(eventId) ?? new Map<string, OccurrenceException>();
    map.set(eventId, byDate);
    const existing = byDate.get(date) ?? { cancelled: false, override: null };
    byDate.set(date, existing);
    return existing;
  }

  const [{ data: cancelRows, error: cancelError }, { data: overrideRows, error: overrideError }] = await Promise.all([
    supabase.from("schedule_event_cancellations").select("event_id, date").eq("user_id", userId).in("event_id", eventIds),
    supabase
      .from("schedule_event_overrides")
      .select("event_id, date, event_time, end_time")
      .eq("user_id", userId)
      .in("event_id", eventIds),
  ]);
  if (cancelError) throw cancelError;
  if (overrideError) throw overrideError;

  for (const row of cancelRows ?? []) {
    entryFor(row.event_id, row.date).cancelled = true;
  }
  for (const row of overrideRows ?? []) {
    entryFor(row.event_id, row.date).override = { eventTime: row.event_time, endTime: row.end_time };
  }
  return map;
}

/**
 * Display precedence when a date carries both: CANCELLATION WINS (Opus
 * Lead ruling). An absent occurrence has no hours to override — "I'm not
 * working Tuesday" is a stronger statement than "Tuesday's hours changed."
 * The override record itself is never deleted by a cancellation (see
 * cancelScheduleOccurrenceCore) — it stays inert underneath so an undo
 * restores the changed hours, not the permanent ones.
 */
export function resolveOccurrence(exceptions: ExceptionsByEvent, eventId: string, date: string): ResolvedOccurrence {
  const exception = exceptions.get(eventId)?.get(date);
  if (!exception) return { kind: "normal" };
  if (exception.cancelled) return { kind: "cancelled" };
  if (exception.override) return { kind: "override", eventTime: exception.override.eventTime, endTime: exception.override.endTime };
  return { kind: "normal" };
}
