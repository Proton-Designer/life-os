import type { HabitDueState, HabitFrequency, HabitStreak } from "../frequency";

/** The "plain daily habit" cadence fields that every habit view-model now carries (HABIT-FREQ); spread into test fixtures. */
export const DAILY_FIELDS: { frequency: HabitFrequency; due: HabitDueState } = {
  frequency: { kind: "daily" },
  due: { due: true, doneToday: false, progress: null, nextDueDate: null, statusText: null },
};

export const DAILY_STREAK = (count: number): HabitStreak => ({ count, unit: "day" });
