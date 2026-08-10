"use client";

import { useState, useTransition } from "react";
import { setWorkoutSchedule } from "@/app/(app)/fitness/actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WorkoutWeekGrid({ schedule }: { schedule: (string | null)[] }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {DAY_LABELS.map((label, dayOfWeek) => (
        <DayCell key={dayOfWeek} dayOfWeek={dayOfWeek} label={label} workoutName={schedule[dayOfWeek]} />
      ))}
    </div>
  );
}

function DayCell({
  dayOfWeek,
  label,
  workoutName,
}: {
  dayOfWeek: number;
  label: string;
  workoutName: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(workoutName ?? "");

  function save() {
    startTransition(async () => {
      await setWorkoutSchedule(dayOfWeek, name.trim() || null, null);
      setOpen(false);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-col items-center gap-1 rounded-lg border border-border/40 p-2 text-xs"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="truncate font-medium">{workoutName ?? "—"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2 p-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workout name (e.g. Push, Rest)"
        />
        <Button type="button" size="sm" disabled={isPending} onClick={save}>
          Save
        </Button>
      </PopoverContent>
    </Popover>
  );
}
