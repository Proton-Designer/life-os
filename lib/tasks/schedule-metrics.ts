import { isOccurrenceCancelled, type CancelledDatesByEvent } from "./schedule-cancellations";

export type ScheduleEventCount = {
  id: string;
  isRecurring: boolean;
  dayOfWeek: number | null;
  eventDate: string | null;
};

/**
 * How many schedule slots are actually filled across the given week — the
 * Schedule panel's own header stat, matching every sibling panel having a
 * real heroValue. Mirrors DomainScheduleView's own per-day filtering logic
 * (recurring-minus-cancelled-this-week, or a one-off dated inside the
 * week) so the count agrees with what the grid itself shows. Cancellation
 * state comes from schedule_event_cancellations (migration 046) via the
 * shared helper — never the deprecated `cancelled_on` column.
 */
export function countScheduledThisWeek(
  events: ScheduleEventCount[],
  weekDates: string[],
  cancelledDates: CancelledDatesByEvent
): number {
  return events.filter((ev) => {
    if (ev.isRecurring) {
      const dateForDay = ev.dayOfWeek !== null ? weekDates[ev.dayOfWeek] : undefined;
      return dateForDay !== undefined && !isOccurrenceCancelled(cancelledDates, ev.id, dateForDay);
    }
    return ev.eventDate !== null && weekDates.includes(ev.eventDate);
  }).length;
}
