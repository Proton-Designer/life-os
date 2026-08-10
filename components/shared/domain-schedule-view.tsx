"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type ScheduleEventData = {
  id: string;
  title: string;
  isRecurring: boolean;
  dayOfWeek: number | null;
  eventTime: string | null;
  eventDate: string | null;
  cancelledOn: string | null;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `weekDates[i]` is this week's actual YYYY-MM-DD for day-of-week `i` — needed to check cancelledOn against the current occurrence. */
export function DomainScheduleView({
  events,
  weekDates,
  addScheduleEvent,
  cancelScheduleOccurrence,
}: {
  events: ScheduleEventData[];
  weekDates: string[];
  addScheduleEvent: (
    title: string,
    options: { isRecurring: boolean; dayOfWeek?: number; eventDate?: string; eventTime?: string }
  ) => Promise<void>;
  cancelScheduleOccurrence: (eventId: string, date: string) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("1");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await addScheduleEvent(trimmed, { isRecurring: true, dayOfWeek: Number(dayOfWeek) });
      setTitle("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-2">
        {DAY_LABELS.map((label, dow) => {
          const dateForDay = weekDates[dow];
          const dayEvents = events.filter((ev) => {
            if (ev.isRecurring) return ev.dayOfWeek === dow && ev.cancelledOn !== dateForDay;
            return ev.eventDate === dateForDay;
          });
          return (
            <div key={dow} className="flex flex-col gap-1 rounded-lg border border-border/40 p-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              {dayEvents.map((ev) => (
                <div key={ev.id} className="flex flex-col gap-1">
                  <span className="truncate text-xs font-medium">{ev.title}</span>
                  {ev.isRecurring && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(() => cancelScheduleOccurrence(ev.id, dateForDay))
                      }
                      className="text-left text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Cancel this week
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Recurring event title"
        />
        <select
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(e.target.value)}
          className="rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {DAY_LABELS.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}
