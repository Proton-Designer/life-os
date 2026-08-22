"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { expandPlanToWeek } from "@/lib/fitness/plan-schedule";
import type { PlanDraft, SessionDraft, SessionExerciseDraft } from "@/lib/fitness/plan-types";
import { ExercisePicker, type ExerciseOption } from "../exercise-picker";
import { WeekPreviewCalendar } from "./week-preview-calendar";
import { SchedulePicker } from "./schedule-picker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MuscleGroup } from "@/lib/fitness/volume";

function emptySession(): SessionDraft {
  return { id: null, name: "", scheduleDays: [1, 2, 3, 4, 5], startTime: null, exercises: [] };
}

/**
 * Routine builder — sessions, each with its own name/schedule/optional
 * start time, holding exercises with a REQUIRED duration and optional
 * weight/sets/reps. Live preview is expandPlanToWeek(draft) on unsaved
 * state, same seam as MicroBuilder.
 */
export function RoutineBuilder({
  initialName,
  initialSessions,
  planId,
  allExercises,
  onCreateExercise,
  onSave,
  onDone,
}: {
  initialName: string;
  initialSessions: SessionDraft[];
  planId: string | null;
  allExercises: ExerciseOption[];
  onCreateExercise: (
    name: string,
    primaryMuscles: MuscleGroup[],
    secondaryMuscles: MuscleGroup[]
  ) => Promise<{ id: string }>;
  onSave: (draft: PlanDraft) => Promise<{ id: string }>;
  onDone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [sessions, setSessions] = useState<SessionDraft[]>(initialSessions);
  const [dirty, setDirty] = useState(false);
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
  }

  function addSession() {
    setSessions((prev) => [...prev, emptySession()]);
    markDirty();
  }

  function updateSession(index: number, patch: Partial<SessionDraft>) {
    setSessions((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    markDirty();
  }

  function removeSession(index: number) {
    setSessions((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  }

  function addExerciseToSession(sessionIndex: number, exercise: ExerciseOption) {
    const draft: SessionExerciseDraft = {
      id: null,
      exerciseId: exercise.id,
      name: exercise.name,
      durationMinutes: 10,
      loadLb: null,
      targetSets: null,
      targetReps: null,
    };
    setSessions((prev) =>
      prev.map((s, i) => (i === sessionIndex ? { ...s, exercises: [...s.exercises, draft] } : s))
    );
    markDirty();
  }

  function updateSessionExercise(sessionIndex: number, exerciseIndex: number, patch: Partial<SessionExerciseDraft>) {
    setSessions((prev) =>
      prev.map((s, i) =>
        i === sessionIndex
          ? { ...s, exercises: s.exercises.map((e, j) => (j === exerciseIndex ? { ...e, ...patch } : e)) }
          : s
      )
    );
    markDirty();
  }

  function removeSessionExercise(sessionIndex: number, exerciseIndex: number) {
    setSessions((prev) =>
      prev.map((s, i) => (i === sessionIndex ? { ...s, exercises: s.exercises.filter((_, j) => j !== exerciseIndex) } : s))
    );
    markDirty();
  }

  const draft: PlanDraft = useMemo(() => ({ kind: "routine", id: planId, name, sessions }), [planId, name, sessions]);
  const preview = useMemo(() => expandPlanToWeek(draft), [draft]);

  const canSave = name.trim().length > 0 && sessions.length > 0 && sessions.every((s) => s.name.trim().length > 0);

  function handleSave() {
    startSaving(async () => {
      await onSave(draft);
      setDirty(false);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="routine-builder">
      <Input
        placeholder="Workout name"
        aria-label="Workout name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          markDirty();
        }}
      />

      <ul className="flex flex-col gap-4">
        {sessions.map((session, sessionIndex) => (
          <li
            key={session.id ?? `session-${sessionIndex}`}
            data-testid={`session-row-${sessionIndex}`}
            className="flex flex-col gap-2 rounded-lg border border-border/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <Input
                placeholder="Session name"
                aria-label={`Session ${sessionIndex + 1} name`}
                value={session.name}
                onChange={(e) => updateSession(sessionIndex, { name: e.target.value })}
                className="max-w-xs"
              />
              <button
                type="button"
                aria-label={`Remove session ${session.name || sessionIndex + 1}`}
                onClick={() => removeSession(sessionIndex)}
                className="min-h-11 min-w-11 rounded-md border border-border/40 text-sm text-muted-foreground"
              >
                ✕
              </button>
            </div>
            <SchedulePicker
              label="Schedule"
              value={session.scheduleDays}
              onChange={(days) => updateSession(sessionIndex, { scheduleDays: days })}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Start time (optional — unscheduled if blank)
              <Input
                type="time"
                aria-label={`Session ${sessionIndex + 1} start time`}
                value={session.startTime ?? ""}
                onChange={(e) => updateSession(sessionIndex, { startTime: e.target.value || null })}
                className="w-32"
              />
            </label>

            <ul className="flex flex-col gap-2">
              {session.exercises.map((exercise, exerciseIndex) => (
                <li
                  key={exercise.id ?? `${exercise.exerciseId}-${exerciseIndex}`}
                  data-testid={`session-${sessionIndex}-exercise-${exerciseIndex}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/30 p-2"
                >
                  <span className="min-w-0 flex-1 text-sm font-medium">{exercise.name}</span>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Duration (min)
                    <Input
                      type="number"
                      aria-label={`${exercise.name} duration minutes`}
                      className="w-16"
                      value={exercise.durationMinutes}
                      onChange={(e) =>
                        updateSessionExercise(sessionIndex, exerciseIndex, { durationMinutes: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Weight
                    <Input
                      type="number"
                      aria-label={`${exercise.name} weight`}
                      className="w-16"
                      value={exercise.loadLb ?? ""}
                      onChange={(e) =>
                        updateSessionExercise(sessionIndex, exerciseIndex, {
                          loadLb: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Sets
                    <Input
                      type="number"
                      aria-label={`${exercise.name} sets`}
                      className="w-14"
                      value={exercise.targetSets ?? ""}
                      onChange={(e) =>
                        updateSessionExercise(sessionIndex, exerciseIndex, {
                          targetSets: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Reps
                    <Input
                      type="number"
                      aria-label={`${exercise.name} reps`}
                      className="w-14"
                      value={exercise.targetReps ?? ""}
                      onChange={(e) =>
                        updateSessionExercise(sessionIndex, exerciseIndex, {
                          targetReps: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${exercise.name} from ${session.name || "session"}`}
                    onClick={() => removeSessionExercise(sessionIndex, exerciseIndex)}
                    className="min-h-11 min-w-11 rounded-md border border-border/40 text-sm text-muted-foreground"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <ExercisePicker
              exercises={allExercises}
              onSelect={(exercise) => addExerciseToSession(sessionIndex, exercise)}
              onCreate={onCreateExercise}
            />
          </li>
        ))}
      </ul>

      <Button type="button" variant="outline" onClick={addSession} className="min-h-11 w-fit">
        + Add session
      </Button>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Week preview</p>
        <WeekPreviewCalendar preview={preview} />
      </div>

      <Button type="button" onClick={handleSave} disabled={isSaving || !canSave} data-dirty={dirty}>
        {dirty ? "Save*" : "Save"}
      </Button>
    </div>
  );
}
