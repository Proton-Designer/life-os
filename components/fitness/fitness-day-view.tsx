"use client";

import { useState } from "react";
import { DayPickerStrip, type DayCell } from "./day-picker-strip";
import { SessionDetailPanel, type ConfirmSet } from "./session-detail-panel";
import { AssignWorkoutPicker, type AssignableWorkout } from "./assign-workout-picker";
import type { DayWorkout } from "@/lib/fitness/load-workout-details";

export type { DayWorkout };

export function FitnessDayView({
  days,
  dates,
  dayLabels,
  todayDayOfWeek,
  workoutsByDay,
  confirmedByDay,
  savedWorkouts,
  onConfirm,
  onAssign,
}: {
  days: DayCell[];
  dates: Record<number, string>;
  dayLabels: Record<number, string>;
  todayDayOfWeek: number;
  workoutsByDay: Record<number, DayWorkout | null>;
  confirmedByDay: Record<number, boolean>;
  savedWorkouts: AssignableWorkout[];
  onConfirm: (date: string, workoutId: string, workoutName: string, sets: ConfirmSet[]) => Promise<void>;
  onAssign: (dayOfWeek: number, workoutId: string) => Promise<void>;
}) {
  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState(
    todayDayOfWeek >= 1 && todayDayOfWeek <= 5 ? todayDayOfWeek : 1
  );

  return (
    <div className="flex flex-col gap-4">
      <DayPickerStrip
        days={days}
        selectedDayOfWeek={selectedDayOfWeek}
        todayDayOfWeek={todayDayOfWeek}
        onSelectDay={setSelectedDayOfWeek}
      />
      <SessionDetailPanel
        // Remounts on day switch AND on workout re-assignment for the same
        // day — SessionDetailPanel seeds its editable rows from `workout`
        // once, in a useState initializer, so without a key change here a
        // day switch or a same-day re-assign would silently keep showing
        // the PREVIOUS day's/workout's rows on an already-mounted instance
        // (caught live: assigning a workout to an empty day left the
        // exercise list empty because the instance never remounted).
        key={`${dates[selectedDayOfWeek]}-${workoutsByDay[selectedDayOfWeek]?.id ?? "none"}`}
        date={dates[selectedDayOfWeek]}
        dayLabel={selectedDayOfWeek === todayDayOfWeek ? "Today" : dayLabels[selectedDayOfWeek]}
        workout={workoutsByDay[selectedDayOfWeek] ?? null}
        alreadyConfirmed={confirmedByDay[selectedDayOfWeek] ?? false}
        onConfirm={onConfirm}
      />
      {!workoutsByDay[selectedDayOfWeek] && (
        <AssignWorkoutPicker
          workouts={savedWorkouts}
          onAssign={(workoutId) => onAssign(selectedDayOfWeek, workoutId)}
        />
      )}
    </div>
  );
}
