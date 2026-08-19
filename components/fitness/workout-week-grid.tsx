"use client";

import { useId, useState, useTransition } from "react";
import { setWorkoutSchedule } from "@/app/(app)/fitness/actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DURATION_MIN = 15;
const DURATION_MAX = 240;
const DURATION_STEP = 15;

export type ScheduledWorkout = { workoutName: string; durationMinutes: number | null };

/**
 * Parses the raw text of the duration field. Blank stays blank (null,
 * "use the nominal default") — that's the whole reason the column is
 * nullable (023_workout_schedule_duration.sql), so an empty string must
 * never get coerced into 0 or the min. Anything typed snaps to the
 * nearest 15-minute step and clamps into [15, 240], since a value like 20
 * would otherwise round silently once it reaches the allocation pre-fill.
 */
export function parseDurationInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const snapped = Math.round(n / DURATION_STEP) * DURATION_STEP;
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, snapped));
}

export function WorkoutWeekGrid({ schedule }: { schedule: (ScheduledWorkout | null)[] }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {DAY_LABELS.map((label, dayOfWeek) => (
        <DayCell key={dayOfWeek} dayOfWeek={dayOfWeek} label={label} scheduled={schedule[dayOfWeek]} />
      ))}
    </div>
  );
}

function DayCell({
  dayOfWeek,
  label,
  scheduled,
}: {
  dayOfWeek: number;
  label: string;
  scheduled: ScheduledWorkout | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(scheduled?.workoutName ?? "");
  // String, not number — an <input type="number"> needs a string value to
  // stay genuinely empty rather than coercing to 0, which is what keeps
  // "blank" distinguishable from a real value the whole way to save().
  const [duration, setDuration] = useState(scheduled?.durationMinutes?.toString() ?? "");
  const durationInputId = useId();

  function save() {
    const trimmedName = name.trim() || null;
    startTransition(async () => {
      await setWorkoutSchedule(dayOfWeek, trimmedName, null, trimmedName ? parseDurationInput(duration) : null);
      setOpen(false);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex flex-col items-center gap-1 rounded-lg border border-border/40 p-2 text-xs"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="truncate font-medium">{scheduled?.workoutName ?? "—"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2 p-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workout name (e.g. Push, Rest)"
        />
        <label htmlFor={durationInputId} className="text-xs text-muted-foreground">
          Duration
        </label>
        <Input
          id={durationInputId}
          type="number"
          inputMode="numeric"
          step={DURATION_STEP}
          min={DURATION_MIN}
          max={DURATION_MAX}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="Optional — defaults to 30m"
          className="min-h-11"
        />
        <Button type="button" size="sm" disabled={isPending} onClick={save} className="min-h-11">
          Save
        </Button>
      </PopoverContent>
    </Popover>
  );
}
