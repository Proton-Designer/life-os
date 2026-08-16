export type ScheduleEventCount = {
  isRecurring: boolean;
  dayOfWeek: number | null;
  eventDate: string | null;
  cancelledOn: string | null;
};

/**
 * How many schedule slots are actually filled across the given week — the
 * Schedule panel's own header stat, matching every sibling panel having a
 * real heroValue. Mirrors DomainScheduleView's own per-day filtering logic
 * (recurring-minus-cancelled-this-week, or a one-off dated inside the
 * week) so the count agrees with what the grid itself shows.
 */
export function countScheduledThisWeek(events: ScheduleEventCount[], weekDates: string[]): number {
  return events.filter((ev) => {
    if (ev.isRecurring) {
      const dateForDay = ev.dayOfWeek !== null ? weekDates[ev.dayOfWeek] : undefined;
      return dateForDay !== undefined && ev.cancelledOn !== dateForDay;
    }
    return ev.eventDate !== null && weekDates.includes(ev.eventDate);
  }).length;
}
