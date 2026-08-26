"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ScheduleEventData = {
  id: string;
  title: string;
  isRecurring: boolean;
  dayOfWeek: number | null;
  eventTime: string | null;
  eventDate: string | null;
  /**
   * This recurring event's own cancelled occurrence dates (YYYY-MM-DD),
   * from schedule_event_cancellations (migration 046) — plain string[], not
   * the deprecated single `cancelledOn` column it replaces. Empty/ignored
   * for a non-recurring (`isRecurring: false`) row.
   */
  cancelledDates: string[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A cancelled occurrence used to simply vanish from the grid — Opus Lead
 * traced a real "you missed my class" report to exactly that: a cancelled
 * Tuesday read as "never entered," not "cancelled." Now it renders, struck
 * through, with an Undo — cancelling always has a way back, and confirming
 * before cancelling makes an accidental tap survivable (2026-08-26, night
 * batch item B1).
 */
function CancelControl({
  isCancelled,
  isPending,
  onCancel,
  onUndo,
}: {
  isCancelled: boolean;
  isPending: boolean;
  onCancel: () => void;
  onUndo: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (isCancelled) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={onUndo}
        className="text-left text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Undo cancel
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">Cancel this week?</span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setConfirming(false);
            onCancel();
          }}
          className="font-medium text-destructive hover:underline"
        >
          Yes
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-muted-foreground hover:underline">
          No
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => setConfirming(true)}
      className="text-left text-[10px] text-muted-foreground hover:text-foreground"
    >
      Cancel this week
    </button>
  );
}

/** `weekDates[i]` is this week's actual YYYY-MM-DD for day-of-week `i` — needed to check cancelledDates against the current occurrence. */
export function DomainScheduleView({
  events,
  weekDates,
  addScheduleEvent,
  cancelScheduleOccurrence,
  uncancelScheduleOccurrence,
}: {
  events: ScheduleEventData[];
  weekDates: string[];
  addScheduleEvent: (
    title: string,
    options: { isRecurring: boolean; dayOfWeek?: number; eventDate?: string; eventTime?: string }
  ) => Promise<void>;
  cancelScheduleOccurrence: (eventId: string, date: string) => Promise<void>;
  uncancelScheduleOccurrence: (eventId: string, date: string) => Promise<void>;
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
            if (ev.isRecurring) return ev.dayOfWeek === dow;
            return ev.eventDate === dateForDay;
          });
          return (
            <div key={dow} className="flex flex-col gap-1 rounded-lg border border-border/40 p-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              {dayEvents.map((ev) => {
                const isCancelled = ev.isRecurring && ev.cancelledDates.includes(dateForDay);
                return (
                  <div key={ev.id} className="flex flex-col gap-1">
                    <span
                      className={cn(
                        "truncate text-xs font-medium",
                        isCancelled && "text-muted-foreground line-through"
                      )}
                    >
                      {ev.title}
                      {isCancelled && <span className="ml-1 font-normal">(cancelled)</span>}
                    </span>
                    {ev.isRecurring && (
                      <CancelControl
                        isCancelled={isCancelled}
                        isPending={isPending}
                        onCancel={() => startTransition(() => cancelScheduleOccurrence(ev.id, dateForDay))}
                        onUndo={() => startTransition(() => uncancelScheduleOccurrence(ev.id, dateForDay))}
                      />
                    )}
                  </div>
                );
              })}
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
