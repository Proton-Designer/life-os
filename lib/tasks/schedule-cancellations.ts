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
